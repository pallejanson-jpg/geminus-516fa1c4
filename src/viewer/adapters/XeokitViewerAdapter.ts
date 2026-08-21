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
 * Annotation/selection methods are stubs in Phase 1 (persistence is out of scope
 * until Phase 2) — they resolve immediately without doing anything, and
 * onSelectionChanged/onAnnotationCreateRequested return no-op unsubscribes.
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
import { logger } from '@/lib/logger';

const VIEWER_POLL_INTERVAL_MS = 200;
const CAMERA_FLIGHT_DURATION_S = 0.5;

/**
 * Minimal shape of the parts of the real xeokit Viewer/Camera this adapter touches.
 * xeokit-sdk isn't an npm dependency (loaded at runtime, see Phase 0 notes), so there's
 * no shipped type package to import — this is a deliberately narrow, hand-written slice.
 */
interface XeokitCamera {
  eye: number[];
  look: number[];
  up: number[];
  on(event: string, cb: () => void): number | string;
  off(subscriptionId: number | string): void;
}

interface XeokitCameraFlight {
  flyTo(params: { eye: number[]; look: number[]; up: number[]; duration: number }): void;
}

interface XeokitViewer {
  scene?: { camera?: XeokitCamera };
  cameraFlight?: XeokitCameraFlight;
}

function getGlobalXeokitViewer(): XeokitViewer | null {
  return (window as unknown as { __nativeXeokitViewer?: XeokitViewer }).__nativeXeokitViewer ?? null;
}

export interface XeokitViewerAdapterOptions {
  buildingFmGuid: string;
  /** Returns the currently-active floor, if any — read live so it can change after construction. */
  getFloorFmGuid?: () => string | undefined;
}

export class XeokitViewerAdapter implements SpatialViewerAdapter {
  private buildingFmGuid: string;
  private getFloorFmGuid: () => string | undefined;
  private poseListeners = new Set<(pose: SpatialPose) => void>();
  private viewMatrixSubscriptionId: number | string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private attachedViewer: XeokitViewer | null = null;

  constructor(options: XeokitViewerAdapterOptions) {
    this.buildingFmGuid = options.buildingFmGuid;
    this.getFloorFmGuid = options.getFloorFmGuid ?? (() => undefined);
  }

  async initialize(): Promise<void> {
    const existing = getGlobalXeokitViewer();
    if (existing) {
      this.attachToViewer(existing);
      return;
    }
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
    logger.debug('[XeokitViewerAdapter] selectEntity not implemented until Phase 2');
  }

  async showAnnotation(_annotation: ViewerAnnotation): Promise<void> {
    logger.debug('[XeokitViewerAdapter] showAnnotation not implemented until Phase 2');
  }

  async removeAnnotation(_assetFmGuid: string): Promise<void> {
    logger.debug('[XeokitViewerAdapter] removeAnnotation not implemented until Phase 2');
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
  }
}
