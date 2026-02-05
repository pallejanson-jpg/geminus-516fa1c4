import { useRef, useCallback, useEffect } from 'react';

interface FloorBounds {
  id: string;
  name: string;
  minY: number;
  maxY: number;
  metaObjectIds: string[];
}

export type ClipMode = 'ceiling' | 'floor';

interface SectionPlaneClippingOptions {
  enabled?: boolean;
  offset?: number; // Extra height above floor ceiling for clipping
  clipMode?: ClipMode; // 'ceiling' for 3D solo, 'floor' for 2D plan view
  floorCutHeight?: number; // Height above floor for 2D clipping (default 1.2m)
}

// Custom event for floor selection changes
export const FLOOR_SELECTION_CHANGED_EVENT = 'FLOOR_SELECTION_CHANGED';
export const VIEW_MODE_CHANGED_EVENT = 'VIEW_MODE_CHANGED';
export const CLIP_HEIGHT_CHANGED_EVENT = 'CLIP_HEIGHT_CHANGED';
export const CLIP_HEIGHT_3D_CHANGED_EVENT = 'CLIP_HEIGHT_3D_CHANGED';

export interface FloorSelectionEventDetail {
  floorId: string | null;
  floorName?: string | null;
  bounds?: { minY: number; maxY: number } | null;
  /** All visible metaObject storey IDs (xeokit internal IDs) */
  visibleMetaFloorIds?: string[];
  /** All visible floor FM GUIDs (database originalSystemId) */
  visibleFloorFmGuids?: string[];
  /** True when all floors are visible (no isolation) */
  isAllFloorsVisible?: boolean;
}

export interface ViewModeEventDetail {
  mode: '2d' | '3d';
  floorId?: string | null;
}

export interface ClipHeightEventDetail {
  height: number; // Height in meters above floor
}

export interface ClipHeight3DEventDetail {
  offset: number; // Offset in meters from next floor boundary (negative = lower)
}

/**
 * Hook for managing horizontal SectionPlane clipping at floor boundaries.
 * 
 * CORRECTED xeokit SectionPlane semantics:
 * - The `dir` vector points toward the DISCARDED half-space
 * - To clip ABOVE a plane (show floor only): dir = [0, 1, 0] (UP = discard above)
 * - To clip BELOW a plane: dir = [0, -1, 0] (DOWN = discard below)
 * 
 * Modes:
 * - 'ceiling': Clips above ceiling height (for 3D single-floor view) - dir UP
 * - 'floor': Clips above floor cut height (for 2D floor plan view) - uses two planes for slab slice
 */
export function useSectionPlaneClipping(
  viewerRef: React.MutableRefObject<any>,
  options: SectionPlaneClippingOptions = {}
) {
  const { enabled = true, offset: initialOffset = 0.05, clipMode = 'ceiling', floorCutHeight: initialFloorCutHeight = 1.2 } = options;
  
  // Separate refs for 2D (top+bottom) and 3D (ceiling) planes
  const topPlaneRef = useRef<any>(null);
  const bottomPlaneRef = useRef<any>(null);
  const ceilingPlaneRef = useRef<any>(null);
  
  const currentFloorIdRef = useRef<string | null>(null);
  const currentClipModeRef = useRef<ClipMode | null>(null);
  const floorCutHeightRef = useRef<number>(initialFloorCutHeight);
  const currentFloorMinYRef = useRef<number>(0);
  const ceiling3DOffsetRef = useRef<number>(initialOffset);
  const nextFloorMinYRef = useRef<number | null>(null);

  // Get XEOkit viewer instance
  const getXeokitViewer = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    } catch (e) {
      return null;
    }
  }, [viewerRef]);

  /**
   * Ensure all entities in the scene are clippable.
   * Required for SectionPlanes to work correctly - xeokit SectionPlanes only
   * clip entities that have clippable: true.
   */
  const ensureAllEntitiesClippable = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene?.objects) return;
    
    const objects = viewer.scene.objects;
    let count = 0;
    
    Object.values(objects).forEach((entity: any) => {
      if (entity && entity.clippable === false) {
        entity.clippable = true;
        count++;
      }
    });
    
    if (count > 0) {
      console.log(`✅ [SectionPlane] Enabled clippable on ${count} entities`);
    }
  }, [getXeokitViewer]);

  /**
   * Create a SectionPlane directly on the scene using xeokit's internal API.
   */
  const createSectionPlaneOnScene = useCallback((
    viewer: any,
    id: string,
    pos: [number, number, number],
    dir: [number, number, number]
  ): any => {
    const scene = viewer.scene;
    if (!scene) return null;

    // Method 1: Direct SectionPlane constructor from scene
    const SectionPlaneClass = scene.SectionPlane;
    if (SectionPlaneClass) {
      try {
        const plane = new SectionPlaneClass(scene, { id, pos, dir, active: true });
        console.log(`✅ SectionPlane created: ${id} at Y=${pos[1].toFixed(2)}, dir=${JSON.stringify(dir)}`);
        return plane;
      } catch (e) {
        console.debug('scene.SectionPlane constructor failed:', e);
      }
    }

    // Method 2: Use xeokit global SectionPlane if available
    const GlobalSectionPlane = (window as any).xeokit?.SectionPlane || (window as any).SectionPlane;
    if (GlobalSectionPlane) {
      try {
        const plane = new GlobalSectionPlane(scene, { id, pos, dir, active: true });
        console.log(`✅ SectionPlane created via global: ${id} at Y=${pos[1].toFixed(2)}`);
        return plane;
      } catch (e) {
        console.debug('Global SectionPlane constructor failed:', e);
      }
    }

    // Method 3: Try scene.createSectionPlane helper if available
    if (typeof scene.createSectionPlane === 'function') {
      try {
        const plane = scene.createSectionPlane({ id, pos, dir, active: true });
        console.log(`✅ SectionPlane created via helper: ${id} at Y=${pos[1].toFixed(2)}`);
        return plane;
      } catch (e) {
        console.debug('scene.createSectionPlane failed:', e);
      }
    }

    // Method 4: Try using xeokit's Component class if available
    const sectionPlanes = scene.sectionPlanes;
    if (sectionPlanes && typeof sectionPlanes.create === 'function') {
      try {
        const plane = sectionPlanes.create({ id, pos, dir, active: true });
        console.log(`✅ SectionPlane created via sectionPlanes.create: ${id}`);
        return plane;
      } catch (e) {
        console.debug('scene.sectionPlanes.create failed:', e);
      }
    }

    console.warn('❌ Could not create SectionPlane - no method available');
    return null;
  }, []);

  /**
   * Safely destroy a section plane
   */
  const destroyPlane = useCallback((planeRef: React.MutableRefObject<any>) => {
    if (planeRef.current) {
      try {
        planeRef.current.destroy?.();
      } catch (e) {
        console.debug('Error destroying section plane:', e);
      }
      planeRef.current = null;
    }
  }, []);

  /**
   * Remove all clipping planes (both 2D and 3D)
   */
  const removeAllClippingPlanes = useCallback(() => {
    destroyPlane(topPlaneRef);
    destroyPlane(bottomPlaneRef);
    destroyPlane(ceilingPlaneRef);
    
    // Also clean up any lingering planes with our prefixes
    const viewer = getXeokitViewer();
    if (viewer?.scene?.sectionPlanes) {
      const existingPlanes = viewer.scene.sectionPlanes;
      Object.keys(existingPlanes).forEach(planeId => {
        if (planeId.startsWith('floor-clip-') || planeId.startsWith('2d-') || planeId.startsWith('3d-ceiling-')) {
          try {
            existingPlanes[planeId].destroy?.();
          } catch (e) {
            console.debug('Error destroying existing plane:', planeId, e);
          }
        }
      });
    }
  }, [destroyPlane, getXeokitViewer]);

  // Calculate floor bounds from metaScene
  const calculateFloorBounds = useCallback((floorId: string): FloorBounds | null => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects || !viewer?.scene?.objects) return null;

    const metaObjects = viewer.metaScene.metaObjects;
    const scene = viewer.scene;
    const floorMeta = metaObjects[floorId];

    if (!floorMeta) return null;

    // Build list of all child object IDs
    const getAllChildIds = (metaObj: any): string[] => {
      const ids: string[] = [metaObj.id];
      (metaObj.children || []).forEach((child: any) => {
        ids.push(...getAllChildIds(child));
      });
      return ids;
    };

    const childIds = getAllChildIds(floorMeta);
    
    // Calculate bounding box from all child entities
    let minY = Infinity;
    let maxY = -Infinity;
    let hasValidBounds = false;

    childIds.forEach(id => {
      const entity = scene.objects[id];
      if (entity?.aabb) {
        const aabb = entity.aabb;
        // aabb format: [minX, minY, minZ, maxX, maxY, maxZ]
        if (aabb[1] < minY) minY = aabb[1];
        if (aabb[4] > maxY) maxY = aabb[4];
        hasValidBounds = true;
      }
    });

    if (!hasValidBounds) {
      console.debug('No valid bounds found for floor:', floorId);
      return null;
    }

    return {
      id: floorId,
      name: floorMeta.name || 'Floor',
      minY,
      maxY,
      metaObjectIds: childIds,
    };
  }, [getXeokitViewer]);

  // Calculate clip height from floor boundary (for 3D Solo mode)
  // This finds the next floor's base height instead of using geometry max
  const calculateClipHeightFromFloorBoundary = useCallback((floorId: string): { clipHeight: number; nextFloorMinY: number | null } | null => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects || !viewer?.scene) return null;

    const metaObjects = viewer.metaScene.metaObjects;

    // Collect all storeys with their bounds
    const storeys: { id: string; name: string; minY: number; maxY: number }[] = [];

    Object.values(metaObjects).forEach((metaObj: any) => {
      if (metaObj.type?.toLowerCase() !== 'ifcbuildingstorey') return;

      // Calculate bounds for this storey
      const bounds = calculateFloorBounds(metaObj.id);
      if (bounds) {
        storeys.push({
          id: metaObj.id,
          name: bounds.name,
          minY: bounds.minY,
          maxY: bounds.maxY,
        });
      }
    });

    if (storeys.length === 0) return null;

    // Sort by minY (lowest first = lowest floor)
    storeys.sort((a, b) => a.minY - b.minY);

    // Find selected storey and next storey
    const currentIndex = storeys.findIndex(s => s.id === floorId);
    if (currentIndex === -1) {
      console.debug('Floor not found in storeys list:', floorId);
      return null;
    }

    if (currentIndex < storeys.length - 1) {
      // Clip at next floor's base level
      const nextFloor = storeys[currentIndex + 1];
      console.log(`3D Clipping: At next floor boundary ${nextFloor.name} minY=${nextFloor.minY.toFixed(2)}`);
      return { clipHeight: nextFloor.minY, nextFloorMinY: nextFloor.minY };
    } else {
      // Top floor - clip at own maxY + small offset
      const topFloor = storeys[currentIndex];
      console.log(`3D Clipping: Top floor - at maxY + offset: ${(topFloor.maxY + 0.1).toFixed(2)}`);
      return { clipHeight: topFloor.maxY + 0.1, nextFloorMinY: null };
    }
  }, [getXeokitViewer, calculateFloorBounds]);

  /**
   * Apply 3D ceiling clipping (solo floor mode)
   * Uses a single plane with dir [0, 1, 0] to discard geometry ABOVE the ceiling
   */
  const applyCeilingClipping = useCallback((floorId: string) => {
    if (!enabled) return;

    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;

    // CRITICAL: Ensure all entities are clippable before applying section planes
    ensureAllEntitiesClippable();

    // Remove any existing 2D planes first (switching modes)
    destroyPlane(topPlaneRef);
    destroyPlane(bottomPlaneRef);
    
    const result = calculateClipHeightFromFloorBoundary(floorId);
    if (!result) {
      console.debug('Could not calculate ceiling clipping height for:', floorId);
      return;
    }
    
    const { clipHeight: baseClipHeight, nextFloorMinY } = result;
    nextFloorMinYRef.current = nextFloorMinY;

    // Get floor bounds for reference
    const bounds = calculateFloorBounds(floorId);
    const floorName = bounds?.name || floorId;
    
    // Store floor minY for reference
    if (bounds) {
      currentFloorMinYRef.current = bounds.minY;
    }

    // Remove existing ceiling plane
    destroyPlane(ceilingPlaneRef);

    // Apply user offset to clip height
    const adjustedClipHeight = baseClipHeight + ceiling3DOffsetRef.current;

    // Create ceiling clipping plane
    // Direction [0, 1, 0] = UP = discard geometry ABOVE the plane
    ceilingPlaneRef.current = createSectionPlaneOnScene(
      viewer,
      `3d-ceiling-${floorId}`,
      [0, adjustedClipHeight, 0],
      [0, 1, 0]  // CORRECTED: UP direction discards above
    );

    if (ceilingPlaneRef.current) {
      console.log(`✅ 3D Ceiling clipping at Y=${adjustedClipHeight.toFixed(2)} for ${floorName} (base: ${baseClipHeight.toFixed(2)}, offset: ${ceiling3DOffsetRef.current}m) [dir: UP = discard above]`);
      currentFloorIdRef.current = floorId;
      currentClipModeRef.current = 'ceiling';
    }
  }, [enabled, getXeokitViewer, calculateFloorBounds, calculateClipHeightFromFloorBoundary, createSectionPlaneOnScene, destroyPlane]);

  /**
   * Apply 2D floor plan clipping (slab slice)
   * Uses two planes:
   * - Top plane: clips above (dir UP) at floor minY + cutHeight
   * - Bottom plane: clips below (dir DOWN) at floor minY + small offset
   */
  const applyFloorPlanClipping = useCallback((floorId: string, customHeight?: number) => {
    if (!enabled) return;

    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;

    // CRITICAL: Ensure all entities are clippable before applying section planes
    ensureAllEntitiesClippable();

    // Remove 3D ceiling plane when switching to 2D
    destroyPlane(ceilingPlaneRef);

    const bounds = calculateFloorBounds(floorId);
    if (!bounds) {
      console.debug('Could not calculate bounds for 2D clipping:', floorId);
      return;
    }

    const floorCutHeight = customHeight ?? floorCutHeightRef.current;
    if (customHeight !== undefined) {
      floorCutHeightRef.current = customHeight;
    }
    
    // Store floor minY
    currentFloorMinYRef.current = bounds.minY;

    // Calculate clip positions
    const topClipY = bounds.minY + floorCutHeight;
    const bottomClipY = bounds.minY + 0.1; // 10cm above floor base (to show floor slab)

    // Remove existing 2D planes
    destroyPlane(topPlaneRef);
    destroyPlane(bottomPlaneRef);

    // Create top clipping plane - clips everything above
    // Direction [0, 1, 0] = UP = discard geometry ABOVE the plane
    topPlaneRef.current = createSectionPlaneOnScene(
      viewer,
      `2d-top-${floorId}`,
      [0, topClipY, 0],
      [0, 1, 0]  // CORRECTED: UP = discard above
    );

    // Create bottom clipping plane - clips everything below
    // Direction [0, -1, 0] = DOWN = discard geometry BELOW the plane
    bottomPlaneRef.current = createSectionPlaneOnScene(
      viewer,
      `2d-bottom-${floorId}`,
      [0, bottomClipY, 0],
      [0, -1, 0]  // DOWN = discard below
    );

    if (topPlaneRef.current && bottomPlaneRef.current) {
      console.log(`✅ 2D Slab slice: bottom=${bottomClipY.toFixed(2)}, top=${topClipY.toFixed(2)} for ${bounds.name}`);
      currentFloorIdRef.current = floorId;
      currentClipModeRef.current = 'floor';
    }
  }, [enabled, getXeokitViewer, calculateFloorBounds, createSectionPlaneOnScene, destroyPlane]);

  /**
   * Apply global floor plan clipping without specific floor ID (uses scene base height)
   */
  const applyGlobalFloorPlanClipping = useCallback((baseHeight: number) => {
    if (!enabled) return;

    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;

    // Remove 3D ceiling plane
    destroyPlane(ceilingPlaneRef);
    
    const floorCutHeight = floorCutHeightRef.current;
    const topClipY = baseHeight + floorCutHeight;
    const bottomClipY = baseHeight + 0.1;
    
    currentFloorMinYRef.current = baseHeight;

    // Remove existing 2D planes
    destroyPlane(topPlaneRef);
    destroyPlane(bottomPlaneRef);

    // Create planes
    topPlaneRef.current = createSectionPlaneOnScene(
      viewer,
      `2d-global-top`,
      [0, topClipY, 0],
      [0, 1, 0]
    );

    bottomPlaneRef.current = createSectionPlaneOnScene(
      viewer,
      `2d-global-bottom`,
      [0, bottomClipY, 0],
      [0, -1, 0]
    );

    if (topPlaneRef.current) {
      console.log(`✅ Global 2D clipping: bottom=${bottomClipY.toFixed(2)}, top=${topClipY.toFixed(2)}`);
      currentFloorIdRef.current = null;
      currentClipModeRef.current = 'floor';
    }
  }, [enabled, getXeokitViewer, createSectionPlaneOnScene, destroyPlane]);

  /**
   * Update 3D ceiling clip height offset dynamically (for 3D mode slider)
   */
  const update3DCeilingOffset = useCallback((newOffset: number) => {
    ceiling3DOffsetRef.current = newOffset;
    
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;
    
    // Only update if we're in 3D ceiling mode
    if (currentClipModeRef.current !== 'ceiling') {
      console.debug('Not in 3D ceiling mode, skipping offset update');
      return;
    }
    
    // Calculate new clip position
    const baseHeight = nextFloorMinYRef.current ?? (currentFloorMinYRef.current + 3.0); // Default 3m floor height
    const newClipY = baseHeight + newOffset;
    
    // Try to update existing plane position directly
    if (ceilingPlaneRef.current) {
      try {
        ceilingPlaneRef.current.pos = [0, newClipY, 0];
        console.log(`✅ 3D ceiling plane pos updated to Y=${newClipY.toFixed(2)} (offset: ${newOffset}m)`);
        return;
      } catch (e) {
        console.debug('Direct pos update failed, recreating plane:', e);
      }
    }
    
    // Fallback: recreate with stable ID
    destroyPlane(ceilingPlaneRef);
    
    ceilingPlaneRef.current = createSectionPlaneOnScene(
      viewer,
      `3d-ceiling-stable`,
      [0, newClipY, 0],
      [0, 1, 0]
    );

    if (ceilingPlaneRef.current) {
      console.log(`✅ 3D ceiling plane recreated at Y=${newClipY.toFixed(2)} (offset: ${newOffset}m)`);
    }
  }, [getXeokitViewer, createSectionPlaneOnScene, destroyPlane]);

  /**
   * Update floor cut height dynamically (for 2D mode slider)
   * FIX: Update existing plane position directly instead of recreating
   */
  const updateFloorCutHeight = useCallback((newHeight: number) => {
    floorCutHeightRef.current = newHeight;
    
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;
    
    // Only update if we're in 2D mode
    if (currentClipModeRef.current !== 'floor') {
      console.debug('Not in 2D mode, skipping height update');
      return;
    }
    
    // Calculate new top clip position using stored floor base
    const topClipY = currentFloorMinYRef.current + newHeight;
    
    // Try to update existing plane position directly (preferred method)
    if (topPlaneRef.current) {
      try {
        // xeokit SectionPlane pos is settable directly
        topPlaneRef.current.pos = [0, topClipY, 0];
        console.log(`✅ 2D top plane pos updated to Y=${topClipY.toFixed(2)} (height: ${newHeight}m)`);
        return;
      } catch (e) {
        console.debug('Direct pos update failed, recreating plane:', e);
      }
    }
    
    // Fallback: recreate with stable ID if direct update fails or plane doesn't exist
    destroyPlane(topPlaneRef);
    
    topPlaneRef.current = createSectionPlaneOnScene(
      viewer,
      `2d-top-stable`,  // Use stable ID instead of dynamic timestamp
      [0, topClipY, 0],
      [0, 1, 0]
    );

    if (topPlaneRef.current) {
      console.log(`✅ 2D top plane recreated at Y=${topClipY.toFixed(2)} (height: ${newHeight}m)`);
    }
  }, [getXeokitViewer, createSectionPlaneOnScene, destroyPlane]);

  /**
   * Remove all section planes
   */
  const removeSectionPlane = useCallback(() => {
    removeAllClippingPlanes();
    currentFloorIdRef.current = null;
    currentClipModeRef.current = null;
    console.log('All section planes removed');
  }, [removeAllClippingPlanes]);

  /**
   * Remove only 2D planes (when switching to 3D)
   */
  const remove2DClipping = useCallback(() => {
    destroyPlane(topPlaneRef);
    destroyPlane(bottomPlaneRef);
    if (currentClipModeRef.current === 'floor') {
      currentClipModeRef.current = null;
    }
    console.log('2D clipping planes removed');
  }, [destroyPlane]);

  /**
   * Remove only 3D ceiling plane (when switching to 2D)
   */
  const remove3DClipping = useCallback(() => {
    destroyPlane(ceilingPlaneRef);
    if (currentClipModeRef.current === 'ceiling') {
      currentClipModeRef.current = null;
    }
    console.log('3D ceiling clipping plane removed');
  }, [destroyPlane]);

  /**
   * Legacy: Apply section plane based on mode
   */
  const applySectionPlane = useCallback((floorId: string, mode?: ClipMode) => {
    const effectiveMode = mode || clipMode;
    if (effectiveMode === 'ceiling') {
      applyCeilingClipping(floorId);
    } else {
      applyFloorPlanClipping(floorId);
    }
  }, [clipMode, applyCeilingClipping, applyFloorPlanClipping]);

  /**
   * Update clipping based on visible floors (for 3D ceiling clipping)
   */
  const updateClipping = useCallback((visibleFloorIds: string[]) => {
    // Only apply clipping when exactly one floor is visible
    if (visibleFloorIds.length === 1) {
      const floorId = visibleFloorIds[0];
      
      // Only update if floor changed
      if (floorId !== currentFloorIdRef.current || currentClipModeRef.current !== 'ceiling') {
        applyCeilingClipping(floorId);
      }
    } else {
      // Multiple or all floors visible - remove 3D clipping
      if (currentClipModeRef.current === 'ceiling') {
        remove3DClipping();
      }
    }
  }, [applyCeilingClipping, remove3DClipping]);

  // Get current floor bounds (for external use)
  const getCurrentFloorBounds = useCallback(() => {
    if (!currentFloorIdRef.current) return null;
    return calculateFloorBounds(currentFloorIdRef.current);
  }, [calculateFloorBounds]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      removeAllClippingPlanes();
    };
  }, [removeAllClippingPlanes]);

  return {
    updateClipping,
    applySectionPlane,
    applyFloorPlanClipping,
    applyGlobalFloorPlanClipping,
    applyCeilingClipping,
    removeSectionPlane,
    remove2DClipping,
    remove3DClipping,
    updateFloorCutHeight,
    update3DCeilingOffset,
    calculateFloorBounds,
    getCurrentFloorBounds,
    isClippingActive: currentFloorIdRef.current !== null || currentClipModeRef.current !== null,
    currentFloorId: currentFloorIdRef.current,
    currentClipMode: currentClipModeRef.current,
    currentFloorCutHeight: floorCutHeightRef.current,
    current3DCeilingOffset: ceiling3DOffsetRef.current,
  };
}

export default useSectionPlaneClipping;
