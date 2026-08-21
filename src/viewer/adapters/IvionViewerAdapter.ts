/**
 * IvionViewerAdapter — wraps the live NavVis Ivion SDK API.
 *
 * Per Phase 0 verification (docs/viewer-current-state-verified.md, answer to open
 * question #1): Ivion360View.tsx loads a real SDK instance first (local bundle ->
 * direct script tag -> CORS proxy) and only falls back to a plain iframe if all three
 * fail. This adapter assumes the SDK is available; if it isn't, getPose()/onPoseChanged
 * simply produce nothing (matching today's "manual URL paste only" iframe-mode
 * limitation — Phase 1 doesn't add iframe-mode adapter support, since the iframe has
 * no programmatic read API to poll).
 *
 * Annotation/selection methods are stubs in Phase 1, same as XeokitViewerAdapter.
 */

import type {
  SpatialPose,
  SpatialViewerAdapter,
  ViewerAnnotation,
  ViewerAnnotationDraft,
  ViewerSelection,
} from '../types';
import type { IvionApi } from '@/lib/ivion-sdk';
import { resolveMainView, resolveMoveTo } from '@/lib/ivion-sdk';
import {
  transformPoint,
  transformHeadingDeg,
  invertTransform,
  normalizeHeadingDeg,
  type PoseTransform,
} from '../SpatialReferenceService';
import { findNearestCandidate, type SpatialCandidate } from '../nearestImage';
import { logger } from '@/lib/logger';

const POLL_INTERVAL_MS = 200;

export interface IvionViewerAdapterOptions {
  buildingFmGuid: string;
  getFloorFmGuid?: () => string | undefined;
  /** Live accessor — the SDK instance may not be ready yet at construction time. */
  getApi: () => IvionApi | null;
  /** Live accessor for the site's cached images, used for the 3D -> 360 nearest-image lookup. */
  getImageCandidates: () => SpatialCandidate[];
  /** Live accessor — the ivion<->BIM transform can change if recalibrated. */
  getTransform: () => PoseTransform;
}

export class IvionViewerAdapter implements SpatialViewerAdapter {
  private opts: IvionViewerAdapterOptions;
  private poseListeners = new Set<(pose: SpatialPose) => void>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private povUnsubscribe: (() => void) | void | undefined;
  private lastImageId: number | null = null;
  private lastLon: number | null = null;

  constructor(options: IvionViewerAdapterOptions) {
    this.opts = options;
  }

  async initialize(): Promise<void> {
    this.pollTimer = setInterval(() => this.pollAndBroadcast(), POLL_INTERVAL_MS);

    const api = this.opts.getApi();
    try {
      if (api?.pov?.onChange) {
        this.povUnsubscribe = api.pov.onChange(() => this.pollAndBroadcast());
      }
    } catch {
      // pov.onChange not available on this SDK build — polling alone still works.
    }
  }

  private pollAndBroadcast(): void {
    const pose = this.readPoseFromSdk();
    if (pose) for (const listener of this.poseListeners) listener(pose);
  }

  private readPoseFromSdk(): SpatialPose | null {
    const api = this.opts.getApi();
    if (!api) return null;

    let mainView;
    try {
      mainView = resolveMainView(api);
    } catch {
      return null;
    }
    if (!mainView) return null;

    const image = mainView.getImage();
    if (!image) return null;
    const viewDir = mainView.currViewingDir;

    const imageChanged = image.id !== this.lastImageId;
    const lon = viewDir?.lon ?? 0;
    const viewChanged = this.lastLon !== null && Math.abs(lon - this.lastLon) > 0.01;
    if (!imageChanged && !viewChanged) return null;

    this.lastImageId = image.id;
    this.lastLon = lon;

    const transform = this.opts.getTransform();
    const bimPos = transformPoint(image.location, transform);
    const rawHeadingDeg = (lon * 180) / Math.PI;
    const pitchDeg = ((viewDir?.lat ?? 0) * 180) / Math.PI;
    const headingDeg = transformHeadingDeg(rawHeadingDeg, transform);

    return {
      buildingFmGuid: this.opts.buildingFmGuid,
      floorFmGuid: this.opts.getFloorFmGuid?.(),
      position: bimPos,
      orientation: { headingDeg: normalizeHeadingDeg(headingDeg), pitchDeg },
      coordinateSystem: 'geminus-local',
      timestamp: performance.now(),
      source: 'ivion',
      transactionId: crypto.randomUUID(),
    };
  }

  async getPose(): Promise<SpatialPose | null> {
    return this.readPoseFromSdk();
  }

  async setPose(pose: SpatialPose): Promise<void> {
    const api = this.opts.getApi();
    if (!api) return;

    const transform = this.opts.getTransform();
    const inverse = invertTransform(transform);
    const ivionPos = transformPoint(pose.position, inverse);
    const headingDeg = pose.orientation?.headingDeg ?? 0;
    const pitchDeg = pose.orientation?.pitchDeg ?? 0;
    // The transform's rotation is applied forward by transformHeadingDeg; invert by
    // negating what it would add, i.e. transform the heading through the inverse too.
    const ivionHeadingDeg = transformHeadingDeg(headingDeg, inverse);

    const candidates = this.opts.getImageCandidates();
    const nearest = findNearestCandidate(ivionPos, candidates, {
      floorFmGuid: pose.floorFmGuid,
    });

    if (nearest && nearest.id !== this.lastImageId) {
      this.lastImageId = nearest.id;
      const viewDir = {
        lon: (ivionHeadingDeg * Math.PI) / 180,
        lat: (pitchDeg * Math.PI) / 180,
      };
      try {
        await resolveMoveTo(api, nearest.id, viewDir);
      } catch (e) {
        logger.warn('[IvionViewerAdapter] moveToImageId failed:', e);
      }
      return;
    }

    // Same image (or none found) — just nudge the viewing direction if possible.
    try {
      const mainView = resolveMainView(api);
      mainView?.updateOrientation?.({
        lon: (ivionHeadingDeg * Math.PI) / 180,
        lat: (pitchDeg * Math.PI) / 180,
      });
    } catch {
      // SDK might not expose updateOrientation on this build.
    }
  }

  async selectEntity(_selection: ViewerSelection): Promise<void> {
    logger.debug('[IvionViewerAdapter] selectEntity not implemented until Phase 2');
  }

  async showAnnotation(_annotation: ViewerAnnotation): Promise<void> {
    logger.debug('[IvionViewerAdapter] showAnnotation not implemented until Phase 2');
  }

  async removeAnnotation(_assetFmGuid: string): Promise<void> {
    logger.debug('[IvionViewerAdapter] removeAnnotation not implemented until Phase 2');
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
    if (typeof this.povUnsubscribe === 'function') this.povUnsubscribe();
    this.povUnsubscribe = undefined;
    this.poseListeners.clear();
  }
}
