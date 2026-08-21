/**
 * Wires XeokitViewerAdapter + IvionViewerAdapter into the shared ViewerCoordinator for
 * Split View's bidirectional camera sync — replacing useViewerCameraSync +
 * useIvionCameraSync's polling/effect-driven pose sync with the coordinator+adapter
 * model those two hooks were built (Phase 1) to eventually be replaced by.
 *
 * Scope, deliberately narrow:
 * - Split View (desktop) only. VirtualTwin mode's useVirtualTwinSync (one-directional,
 *   Ivion-driven) is untouched — Del B question 3 in
 *   docs/plans/viewer-coordinator-spec-and-prompts.md ("should VT become a special
 *   case of the same coordinator?") was never resolved to a yes, so this doesn't
 *   assume an answer.
 * - Camera pose only. Both adapters are constructed with `manageAnnotations: false` —
 *   annotation rendering stays exactly as it already works today, via
 *   useViewerEventListeners.ts's TOGGLE_ANNOTATIONS handler (which has floor/category
 *   filtering and symbol colors this adapter's bare-bones marker renderer doesn't, and
 *   is gated by a visibility toggle the adapter has no equivalent for). Running both
 *   would draw two independent, competing marker layers.
 *
 * Known, accepted tradeoff: IvionViewerAdapter only supports SDK mode (it reads
 * getMainView()/currViewingDir directly) — unlike the hook it replaces, it has no
 * iframe-mode fallback. When the Ivion SDK fails to load, Split-view camera sync is
 * simply unavailable rather than degrading to iframe-URL sync. This was an explicit,
 * discussed tradeoff, not an oversight.
 */

import { useEffect, useRef } from 'react';
import type { IvionApi } from '@/lib/ivion-sdk';
import type { IvionBimTransform } from '@/lib/ivion-bim-transform';
import { useViewerSync } from '@/viewer/ViewerCoordinatorSyncContext';
import { XeokitViewerAdapter } from '@/viewer/adapters/XeokitViewerAdapter';
import { IvionViewerAdapter } from '@/viewer/adapters/IvionViewerAdapter';
import { buildOffsetRotationTransform, type PoseTransform } from '@/viewer/SpatialReferenceService';
import { useIvionImageCache } from '@/hooks/useIvionImageCache';
import type { SpatialCandidate } from '@/viewer/nearestImage';
import { logger } from '@/lib/logger';

export interface UseViewerCoordinatorSplitSyncOptions {
  enabled: boolean;
  buildingFmGuid: string | undefined;
  ivionSiteId: string;
  ivApiRef: React.MutableRefObject<IvionApi | null>;
  transform: IvionBimTransform;
  getFloorFmGuid: () => string | undefined;
}

export function useViewerCoordinatorSplitSync({
  enabled,
  buildingFmGuid,
  ivionSiteId,
  ivApiRef,
  transform,
  getFloorFmGuid,
}: UseViewerCoordinatorSplitSyncOptions): void {
  const { coordinator } = useViewerSync();

  // Same image cache useIvionCameraSync would have loaded — needed for
  // IvionViewerAdapter.setPose()'s 3D -> 360 nearest-image lookup.
  const { imageCache } = useIvionImageCache(ivionSiteId, buildingFmGuid, enabled);
  const imageCacheRef = useRef<SpatialCandidate[]>([]);
  imageCacheRef.current = imageCache;

  const transformRef = useRef<PoseTransform>(buildOffsetRotationTransform(0, 0, 0, 0));
  transformRef.current = buildOffsetRotationTransform(
    transform.offsetX,
    transform.offsetY,
    transform.offsetZ,
    transform.rotation,
  );

  const getFloorFmGuidRef = useRef(getFloorFmGuid);
  getFloorFmGuidRef.current = getFloorFmGuid;

  useEffect(() => {
    if (!enabled || !buildingFmGuid) return;

    const xeokitAdapter = new XeokitViewerAdapter({
      buildingFmGuid,
      getFloorFmGuid: () => getFloorFmGuidRef.current(),
      manageAnnotations: false,
    });
    const ivionAdapter = new IvionViewerAdapter({
      buildingFmGuid,
      getFloorFmGuid: () => getFloorFmGuidRef.current(),
      getApi: () => ivApiRef.current,
      getImageCandidates: () => imageCacheRef.current,
      getTransform: () => transformRef.current,
      manageAnnotations: false,
    });

    coordinator.registerAdapter('xeokit', xeokitAdapter);
    coordinator.registerAdapter('ivion', ivionAdapter);

    // registerAdapter() only makes the coordinator able to CALL this adapter's
    // setPose() when the OTHER side changes — it does not, by itself, forward this
    // adapter's own pose changes back into the coordinator. That wiring is the
    // caller's job (ViewerCoordinator.ts is deliberately DOM/React-free), so it has to
    // happen here.
    const offXeokitPose = xeokitAdapter.onPoseChanged((pose) => coordinator.submitPose(pose));
    const offIvionPose = ivionAdapter.onPoseChanged((pose) => coordinator.submitPose(pose));

    xeokitAdapter.initialize().catch((e) => logger.warn('[useViewerCoordinatorSplitSync] xeokit adapter init failed:', e));
    ivionAdapter.initialize().catch((e) => logger.warn('[useViewerCoordinatorSplitSync] ivion adapter init failed:', e));

    return () => {
      offXeokitPose();
      offIvionPose();
      coordinator.unregisterAdapter('xeokit');
      coordinator.unregisterAdapter('ivion');
      xeokitAdapter.destroy();
      ivionAdapter.destroy();
    };
    // transform/getFloorFmGuid are read live via refs above so recalibrating or
    // changing floor doesn't tear down and re-create the adapters (and their camera
    // listeners / poll timers) on every change — only enabled/buildingFmGuid/coordinator
    // identity should do that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, buildingFmGuid, coordinator]);
}
