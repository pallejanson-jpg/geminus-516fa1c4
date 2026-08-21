/**
 * XeokitViewerAdapter — wraps the live xeokit viewer instance.
 *
 * Per Phase 0 verification (docs/viewer-current-state-verified.md, answer to open
 * question #2): there is exactly ONE real xeokit viewer in production,
 * NativeXeokitViewer.tsx, exposed globally as `window.__nativeXeokitViewer` by
 * NativeViewerShell.tsx. The old Vue-shaped `$refs.AssetViewer.$refs.assetView.viewer`
 * path some legacy hooks still read is a deliberate backward-compat shim over this
 * same instance — this adapter talks to the real viewer directly and doesn't need to
 * know that shim exists.
 *
 * showAnnotation/removeAnnotation render simple DOM markers positioned over the
 * canvas (the same approach useViewerEventListeners.ts's TOGGLE_ANNOTATIONS handler
 * uses for the actual live UI — there is no working xeokit AnnotationsPlugin instance
 * in this codebase to hook into, see docs/viewer-current-state-verified.md's
 * correction to Del A.2). initialize() loads the building's current annotations once
 * and subscribes to Realtime for further changes; selectEntity/onSelectionChanged/
 * onAnnotationCreateRequested remain stubs — entity selection is a separate concern
 * Phase 2 didn't ask this adapter to take over.
 */

import type {
  SpatialPose,
  SpatialViewerAdapter,
  ViewerAnnotation,
  ViewerAnnotationDraft,
  ViewerSelection,
} from '../types';
import { calculateHeadingFromCamera, calculatePitchFromCamera, calculateLookFromHeadingPitch } from '@/lib/coordinate-transform';
import { normalizeHeadingDeg } from '../SpatialReferenceService';
import { projectWorldToCanvas } from '../worldToCanvas';
import { subscribeToBuildingAnnotations } from '../annotationsRealtime';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';

const VIEWER_POLL_INTERVAL_MS = 200;
const CAMERA_FLIGHT_DURATION_S = 0.5;

interface AnnotationRow {
  fm_guid: string;
  common_name: string | null;
  name: string | null;
  coordinate_x: number | null;
  coordinate_y: number | null;
  coordinate_z: number | null;
  level_fm_guid: string | null;
  symbol_id: string | null;
}

/**
 * Minimal shape of the parts of the real xeokit Viewer/Camera this adapter touches.
 * xeokit-sdk isn't an npm dependency (loaded at runtime, see Phase 0 notes), so there's
 * no shipped type package to import — this is a deliberately narrow, hand-written slice.
 */
interface XeokitCamera {
  eye: number[];
  look: number[];
  up: number[];
  projMatrix?: ArrayLike<number>;
  viewMatrix?: ArrayLike<number>;
  on(event: string, cb: () => void): number | string;
  off(subscriptionId: number | string): void;
}

interface XeokitCameraFlight {
  flyTo(params: { eye: number[]; look: number[]; up: number[]; duration: number }): void;
}

interface XeokitViewer {
  scene?: { camera?: XeokitCamera; canvas?: { canvas?: HTMLCanvasElement } };
  cameraFlight?: XeokitCameraFlight;
}

interface RenderedMarker {
  element: HTMLDivElement;
  worldPos: [number, number, number];
  unsubscribeCamera: () => void;
}

function getGlobalXeokitViewer(): XeokitViewer | null {
  return (window as unknown as { __nativeXeokitViewer?: XeokitViewer }).__nativeXeokitViewer ?? null;
}

export interface XeokitViewerAdapterOptions {
  buildingFmGuid: string;
  /** Returns the currently-active floor, if any — read live so it can change after construction. */
  getFloorFmGuid?: () => string | undefined;
  /**
   * Whether this adapter loads/renders/subscribes to annotations at all. Defaults to
   * true. Set false when registering this adapter purely for camera-pose sync in a
   * context where annotations are already rendered by something else (e.g.
   * useViewerEventListeners.ts's TOGGLE_ANNOTATIONS handler, which additionally has
   * floor/category filtering and symbol colors this adapter's renderer doesn't) —
   * running both would draw two independent, competing sets of markers.
   */
  manageAnnotations?: boolean;
}

export class XeokitViewerAdapter implements SpatialViewerAdapter {
  private buildingFmGuid: string;
  private getFloorFmGuid: () => string | undefined;
  private manageAnnotations: boolean;
  private poseListeners = new Set<(pose: SpatialPose) => void>();
  private viewMatrixSubscriptionId: number | string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private attachedViewer: XeokitViewer | null = null;
  private markerContainer: HTMLDivElement | null = null;
  private markersByAssetFmGuid = new Map<string, RenderedMarker>();
  private unsubscribeRealtime: (() => void) | null = null;

  constructor(options: XeokitViewerAdapterOptions) {
    this.buildingFmGuid = options.buildingFmGuid;
    this.getFloorFmGuid = options.getFloorFmGuid ?? (() => undefined);
    this.manageAnnotations = options.manageAnnotations ?? true;
  }

  async initialize(): Promise<void> {
    const existing = getGlobalXeokitViewer();
    if (existing) {
      this.attachToViewer(existing);
    } else {
      // The viewer mounts asynchronously (NativeViewerShell sets the global once xeokit
      // is ready) — poll until it appears, same pattern UnifiedViewer.tsx already uses.
      this.pollTimer = setInterval(() => {
        const viewer = getGlobalXeokitViewer();
        if (viewer) {
          this.attachToViewer(viewer);
          if (this.pollTimer) clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
      }, VIEWER_POLL_INTERVAL_MS);
    }

    if (!this.manageAnnotations) return;

    await this.refreshAnnotationsFromServer();
    this.unsubscribeRealtime = subscribeToBuildingAnnotations(this.buildingFmGuid, () => {
      this.refreshAnnotationsFromServer().catch((e) =>
        logger.warn('[XeokitViewerAdapter] Realtime-triggered annotation refresh failed:', e),
      );
    });
  }

  /** Load the building's current annotations and reconcile rendered markers to match. */
  private async refreshAnnotationsFromServer(): Promise<void> {
    const { data, error } = await supabase.functions.invoke('viewer-annotations', {
      body: { action: 'list-annotations', buildingFmGuid: this.buildingFmGuid },
    });
    if (error) {
      logger.warn('[XeokitViewerAdapter] Failed to load annotations:', error);
      return;
    }
    const rows: AnnotationRow[] = data?.annotations ?? [];

    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.fm_guid);
      if (row.coordinate_x == null && row.coordinate_y == null && row.coordinate_z == null) {
        // No resolved position yet (e.g. navvis-location/space-centroid without a
        // coordinate) — nothing to place a marker at. Room-centroid fallback is the
        // live UI's job (useViewerEventListeners.ts), not duplicated here.
        this.removeAnnotationMarker(row.fm_guid);
        continue;
      }
      this.showAnnotation({
        assetFmGuid: row.fm_guid,
        symbolId: row.symbol_id,
        label: row.common_name || row.name || undefined,
        pose: {
          buildingFmGuid: this.buildingFmGuid,
          floorFmGuid: row.level_fm_guid ?? undefined,
          position: { x: row.coordinate_x ?? 0, y: row.coordinate_y ?? 0, z: row.coordinate_z ?? 0 },
          coordinateSystem: 'geminus-local',
          timestamp: performance.now(),
          source: 'system',
          transactionId: crypto.randomUUID(),
        },
      });
    }

    for (const assetFmGuid of [...this.markersByAssetFmGuid.keys()]) {
      if (!seen.has(assetFmGuid)) this.removeAnnotationMarker(assetFmGuid);
    }
  }

  private attachToViewer(viewer: XeokitViewer): void {
    if (this.attachedViewer === viewer) return;
    this.attachedViewer = viewer;
    const camera = viewer?.scene?.camera;
    if (!camera) return;

    this.viewMatrixSubscriptionId = camera.on('viewMatrix', () => {
      const pose = this.readPoseFromCamera(camera);
      if (pose) for (const listener of this.poseListeners) listener(pose);
    });
  }

  private readPoseFromCamera(camera: XeokitCamera): SpatialPose | null {
    const eye = camera?.eye;
    const look = camera?.look;
    if (!eye || !look) return null;

    const headingDeg = normalizeHeadingDeg(calculateHeadingFromCamera(eye, look));
    const pitchDeg = calculatePitchFromCamera(eye, look);

    return {
      buildingFmGuid: this.buildingFmGuid,
      floorFmGuid: this.getFloorFmGuid(),
      position: { x: eye[0], y: eye[1], z: eye[2] },
      orientation: { headingDeg, pitchDeg },
      coordinateSystem: 'geminus-local',
      timestamp: performance.now(),
      source: 'xeokit',
      transactionId: crypto.randomUUID(),
    };
  }

  async getPose(): Promise<SpatialPose | null> {
    const viewer = getGlobalXeokitViewer();
    const camera = viewer?.scene?.camera;
    if (!camera) return null;
    return this.readPoseFromCamera(camera);
  }

  async setPose(pose: SpatialPose): Promise<void> {
    const viewer = getGlobalXeokitViewer();
    const camera = viewer?.scene?.camera;
    if (!camera) return;

    const eye: [number, number, number] = [pose.position.x, pose.position.y, pose.position.z];
    const heading = pose.orientation?.headingDeg ?? 0;
    const pitch = pose.orientation?.pitchDeg ?? 0;
    const look = calculateLookFromHeadingPitch(eye, heading, pitch) as [number, number, number];

    const cameraFlight = viewer?.cameraFlight;
    if (cameraFlight?.flyTo) {
      cameraFlight.flyTo({ eye, look, up: [0, 1, 0], duration: CAMERA_FLIGHT_DURATION_S });
    } else {
      camera.eye = eye;
      camera.look = look;
      camera.up = [0, 1, 0];
    }
  }

  async selectEntity(_selection: ViewerSelection): Promise<void> {
    logger.debug('[XeokitViewerAdapter] selectEntity not implemented — out of scope for Phase 2');
  }

  /** Get (creating if needed) the DOM overlay that annotation markers are appended to. */
  private ensureMarkerContainer(): HTMLDivElement | null {
    if (this.markerContainer) return this.markerContainer;
    const canvas = this.attachedViewer?.scene?.canvas?.canvas ?? getGlobalXeokitViewer()?.scene?.canvas?.canvas;
    const parent = canvas?.parentElement;
    if (!parent) return null;

    const container = document.createElement('div');
    container.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:30;overflow:hidden;';
    container.dataset.role = 'viewer-coordinator-annotations';
    parent.appendChild(container);
    this.markerContainer = container;
    return container;
  }

  async showAnnotation(annotation: ViewerAnnotation): Promise<void> {
    const container = this.ensureMarkerContainer();
    const camera = this.attachedViewer?.scene?.camera ?? getGlobalXeokitViewer()?.scene?.camera;
    const canvas = this.attachedViewer?.scene?.canvas?.canvas ?? getGlobalXeokitViewer()?.scene?.canvas?.canvas;
    if (!container || !camera) return;

    const worldPos: [number, number, number] = [
      annotation.pose.position.x,
      annotation.pose.position.y,
      annotation.pose.position.z,
    ];

    const existing = this.markersByAssetFmGuid.get(annotation.assetFmGuid);
    const element = existing?.element ?? document.createElement('div');
    element.style.cssText =
      'position:absolute;pointer-events:auto;cursor:pointer;padding:2px 6px;border-radius:4px;' +
      'font-size:10px;font-weight:500;color:white;background:#3b82f6;white-space:nowrap;' +
      'transform:translate(-50%,-100%);box-shadow:0 1px 3px rgba(0,0,0,0.3);';
    element.textContent = annotation.label || 'Annotation';
    element.title = annotation.label || annotation.assetFmGuid;

    const updatePosition = () => {
      const projected = projectWorldToCanvas(camera, canvas, worldPos);
      if (projected && projected[2] > 0) {
        element.style.left = `${projected[0]}px`;
        element.style.top = `${projected[1]}px`;
        element.style.display = 'block';
      } else {
        element.style.display = 'none';
      }
    };

    if (existing) {
      existing.unsubscribeCamera();
    } else {
      container.appendChild(element);
    }

    let subscriptionId: number | string | undefined;
    try {
      subscriptionId = camera.on('viewMatrix', updatePosition);
    } catch {
      // camera.on may not be available on every camera-like object (e.g. in tests) — the
      // marker just won't reposition on camera move in that case.
    }
    const unsubscribeCamera = () => {
      if (subscriptionId !== undefined) {
        try { camera.off(subscriptionId); } catch { /* already detached */ }
      }
    };

    this.markersByAssetFmGuid.set(annotation.assetFmGuid, { element, worldPos, unsubscribeCamera });
    updatePosition();
  }

  private removeAnnotationMarker(assetFmGuid: string): void {
    const marker = this.markersByAssetFmGuid.get(assetFmGuid);
    if (!marker) return;
    marker.unsubscribeCamera();
    marker.element.remove();
    this.markersByAssetFmGuid.delete(assetFmGuid);
  }

  async removeAnnotation(assetFmGuid: string): Promise<void> {
    this.removeAnnotationMarker(assetFmGuid);
  }

  onPoseChanged(cb: (pose: SpatialPose) => void): () => void {
    this.poseListeners.add(cb);
    return () => this.poseListeners.delete(cb);
  }

  onSelectionChanged(_cb: (sel: ViewerSelection) => void): () => void {
    return () => {};
  }

  onAnnotationCreateRequested(_cb: (draft: ViewerAnnotationDraft) => void): () => void {
    return () => {};
  }

  destroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    const camera = this.attachedViewer?.scene?.camera;
    if (camera && this.viewMatrixSubscriptionId !== null) {
      camera.off(this.viewMatrixSubscriptionId);
    }
    this.viewMatrixSubscriptionId = null;
    this.attachedViewer = null;
    this.poseListeners.clear();

    if (this.unsubscribeRealtime) {
      this.unsubscribeRealtime();
      this.unsubscribeRealtime = null;
    }
    for (const assetFmGuid of [...this.markersByAssetFmGuid.keys()]) {
      this.removeAnnotationMarker(assetFmGuid);
    }
    this.markerContainer?.remove();
    this.markerContainer = null;
  }
}
