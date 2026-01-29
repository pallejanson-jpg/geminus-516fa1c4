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

export interface FloorSelectionEventDetail {
  floorId: string | null;
  floorName?: string | null;
  bounds?: { minY: number; maxY: number } | null;
}

export interface ViewModeEventDetail {
  mode: '2d' | '3d';
  floorId?: string | null;
}

export interface ClipHeightEventDetail {
  height: number; // Height in meters above floor
}

/**
 * Hook for managing horizontal SectionPlane clipping at floor boundaries.
 * 
 * Supports two clipping modes:
 * - 'ceiling': Clips at floor's ceiling height (for 3D single-floor view)
 * - 'floor': Clips ~1.2m above floor level (for 2D floor plan view)
 */
export function useSectionPlaneClipping(
  viewerRef: React.MutableRefObject<any>,
  options: SectionPlaneClippingOptions = {}
) {
  const { enabled = true, offset = 0.05, clipMode = 'ceiling', floorCutHeight: initialFloorCutHeight = 1.2 } = options;
  const sectionPlaneRef = useRef<any>(null);
  const sectionPlanesPluginRef = useRef<any>(null);
  const currentFloorIdRef = useRef<string | null>(null);
  const currentClipModeRef = useRef<ClipMode | null>(null);
  const floorCutHeightRef = useRef<number>(initialFloorCutHeight);

  // Get XEOkit viewer instance
  const getXeokitViewer = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    } catch (e) {
      return null;
    }
  }, [viewerRef]);

  // Initialize SectionPlanesPlugin if not already created
  const initializeSectionPlanesPlugin = useCallback(() => {
    if (sectionPlanesPluginRef.current) return sectionPlanesPluginRef.current;

    const viewer = getXeokitViewer();
    if (!viewer) return null;

    // Check if SectionPlanesPlugin is available globally (from xeokit)
    const SectionPlanesPlugin = (window as any).SectionPlanesPlugin;
    
    if (!SectionPlanesPlugin) {
      // Try to use viewer's built-in section planes if available
      console.debug('SectionPlanesPlugin not available globally, using inline creation');
      return null;
    }

    try {
      sectionPlanesPluginRef.current = new SectionPlanesPlugin(viewer, {
        overviewVisible: false,
      });
      console.log('SectionPlanesPlugin initialized for floor clipping');
      return sectionPlanesPluginRef.current;
    } catch (e) {
      console.debug('Failed to initialize SectionPlanesPlugin:', e);
      return null;
    }
  }, [getXeokitViewer]);

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
  const calculateClipHeightFromFloorBoundary = useCallback((floorId: string): number | null => {
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
      console.log(`Clipping at next floor boundary: ${nextFloor.name} minY=${nextFloor.minY.toFixed(2)}`);
      return nextFloor.minY;
    } else {
      // Top floor - clip at own maxY + small offset
      const topFloor = storeys[currentIndex];
      console.log(`Top floor - clipping at maxY + offset: ${(topFloor.maxY + 0.1).toFixed(2)}`);
      return topFloor.maxY + 0.1;
    }
  }, [getXeokitViewer, calculateFloorBounds]);

  // Create or update horizontal section plane
  const applySectionPlane = useCallback((floorId: string, mode?: ClipMode) => {
    if (!enabled) return;

    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;

    const effectiveMode = mode || clipMode;
    const floorCutHeight = floorCutHeightRef.current;
    
    let clipHeight: number;
    let floorName = 'Unknown';
    
    if (effectiveMode === 'ceiling') {
      // 3D Solo mode: clip at next floor's boundary
      const boundaryHeight = calculateClipHeightFromFloorBoundary(floorId);
      if (!boundaryHeight) {
        console.debug('Could not calculate floor boundary for clipping:', floorId);
        return;
      }
      clipHeight = boundaryHeight;
      
      // Get floor name for logging
      const bounds = calculateFloorBounds(floorId);
      floorName = bounds?.name || floorId;
    } else {
      // 2D floor plan mode: clip at floor level + height offset
      const bounds = calculateFloorBounds(floorId);
      if (!bounds) {
        console.debug('Could not calculate bounds for floor clipping:', floorId);
        return;
      }
      clipHeight = bounds.minY + floorCutHeight;
      floorName = bounds.name;
    }
    
    // Remove existing section plane
    if (sectionPlaneRef.current) {
      try {
        sectionPlaneRef.current.destroy();
      } catch (e) {
        console.debug('Error destroying old section plane:', e);
      }
      sectionPlaneRef.current = null;
    }

    // Try using SectionPlanesPlugin first
    const plugin = initializeSectionPlanesPlugin();
    
    if (plugin) {
      try {
        // Create horizontal section plane
        // For 2D floor plan: dir [0, 1, 0] (points UP) = clips everything ABOVE the plane
        // For 3D ceiling: dir [0, -1, 0] (points DOWN) = clips above ceiling height
        // NOTE: xeokit discards geometry in the direction of 'dir'
        const direction: [number, number, number] = effectiveMode === 'floor' 
          ? [0, 1, 0]   // 2D: clip above floor cut height
          : [0, -1, 0]; // 3D ceiling: clip above ceiling
          
        sectionPlaneRef.current = plugin.createSectionPlane({
          id: `floor-clip-${floorId}-${effectiveMode}`,
          pos: [0, clipHeight, 0],
          dir: direction,
          active: true,
        });
        
        const modeLabel = effectiveMode === 'floor' ? '2D planritning' : 'taknivå (våningsgräns)';
        console.log(`Section plane created at Y=${clipHeight.toFixed(2)} (${modeLabel}) for floor: ${floorName}`);
        currentFloorIdRef.current = floorId;
        currentClipModeRef.current = effectiveMode;
        return;
      } catch (e) {
        console.debug('Failed to create section plane via plugin:', e);
      }
    }

    // Fallback: Create section plane directly on scene
    try {
      const SectionPlane = viewer.scene.SectionPlane || (window as any).SectionPlane;
      const direction: [number, number, number] = effectiveMode === 'floor' 
        ? [0, 1, 0] : [0, -1, 0];
      
      if (SectionPlane) {
        sectionPlaneRef.current = new SectionPlane(viewer.scene, {
          id: `floor-clip-${floorId}-${effectiveMode}`,
          pos: [0, clipHeight, 0],
          dir: direction,
          active: true,
        });
        
        const modeLabel = effectiveMode === 'floor' ? '2D planritning' : 'taknivå (våningsgräns)';
        console.log(`Section plane created (direct) at Y=${clipHeight.toFixed(2)} (${modeLabel}) for floor: ${floorName}`);
        currentFloorIdRef.current = floorId;
        currentClipModeRef.current = effectiveMode;
      } else {
        // Ultimate fallback: Use xeokit scene's sectionPlanes directly
        const sectionPlanes = viewer.scene.sectionPlanes;
        if (sectionPlanes) {
          const planeId = `floor-clip-${floorId}-${effectiveMode}`;
          
          // Create a new section plane using scene API
          viewer.scene.createSectionPlane?.({
            id: planeId,
            pos: [0, clipHeight, 0],
            dir: [0, -1, 0],
            active: true,
          });
          
          sectionPlaneRef.current = { id: planeId, scene: viewer.scene };
          console.log(`Section plane created (scene API) at Y=${clipHeight.toFixed(2)}`);
          currentFloorIdRef.current = floorId;
          currentClipModeRef.current = effectiveMode;
        }
      }
    } catch (e) {
      console.debug('Failed to create section plane directly:', e);
    }
  }, [enabled, clipMode, getXeokitViewer, calculateFloorBounds, calculateClipHeightFromFloorBoundary, initializeSectionPlanesPlugin]);

  // Apply floor plan clipping (2D mode) - convenience function
  const applyFloorPlanClipping = useCallback((floorId: string, customHeight?: number) => {
    if (customHeight !== undefined) {
      floorCutHeightRef.current = customHeight;
    }
    applySectionPlane(floorId, 'floor');
  }, [applySectionPlane]);

  // Apply global floor plan clipping without specific floor ID (uses scene base height)
  const applyGlobalFloorPlanClipping = useCallback((baseHeight: number) => {
    if (!enabled) return;

    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;

    const floorCutHeight = floorCutHeightRef.current;
    const clipHeight = baseHeight + floorCutHeight;
    
    // Remove existing section plane
    if (sectionPlaneRef.current) {
      try {
        sectionPlaneRef.current.destroy();
      } catch (e) {
        console.debug('Error destroying old section plane:', e);
      }
      sectionPlaneRef.current = null;
    }

    // Try using SectionPlanesPlugin first
    const plugin = initializeSectionPlanesPlugin();
    
    if (plugin) {
      try {
        sectionPlaneRef.current = plugin.createSectionPlane({
          id: 'global-floor-clip',
          pos: [0, clipHeight, 0],
          dir: [0, 1, 0], // Points UP = clips everything above (for 2D floor plan)
          active: true,
        });
        
        console.log(`Global section plane created at Y=${clipHeight.toFixed(2)} (2D planritning) [dir: UP]`);
        currentFloorIdRef.current = null;
        currentClipModeRef.current = 'floor';
        return;
      } catch (e) {
        console.debug('Failed to create global section plane via plugin:', e);
      }
    }

    // Fallback: Create section plane directly on scene
    try {
      const SectionPlane = viewer.scene.SectionPlane || (window as any).SectionPlane;
      
      if (SectionPlane) {
        sectionPlaneRef.current = new SectionPlane(viewer.scene, {
          id: 'global-floor-clip',
          pos: [0, clipHeight, 0],
          dir: [0, 1, 0], // Points UP = clips above
          active: true,
        });
        
        console.log(`Global section plane created (direct) at Y=${clipHeight.toFixed(2)} [dir: UP]`);
        currentFloorIdRef.current = null;
        currentClipModeRef.current = 'floor';
      }
    } catch (e) {
      console.debug('Failed to create global section plane directly:', e);
    }
  }, [enabled, getXeokitViewer, initializeSectionPlanesPlugin]);

  // Update floor cut height dynamically - creates or updates section plane in real-time
  const updateFloorCutHeight = useCallback((newHeight: number) => {
    floorCutHeightRef.current = newHeight;
    
    // Get viewer and scene info
    const viewer = getXeokitViewer();
    if (!viewer?.scene) {
      console.debug('No viewer available for clip height update');
      return;
    }
    
    console.log('Updating clip height to:', newHeight);
    
    // Calculate the absolute clip position
    let clipY: number;
    
    if (currentFloorIdRef.current) {
      // If a floor is selected, use its base height + new height
      const bounds = calculateFloorBounds(currentFloorIdRef.current);
      if (bounds) {
        clipY = bounds.minY + newHeight;
      } else {
        // Fallback to scene base
        const sceneAABB = viewer.scene?.getAABB?.();
        clipY = sceneAABB ? sceneAABB[1] + newHeight : newHeight;
      }
    } else {
      // Global - use scene base height
      const sceneAABB = viewer.scene?.getAABB?.();
      clipY = sceneAABB ? sceneAABB[1] + newHeight : newHeight;
    }
    
    // Destroy existing section plane
    if (sectionPlaneRef.current) {
      try {
        sectionPlaneRef.current.destroy?.();
      } catch (e) {
        console.debug('Error destroying section plane during height update:', e);
      }
      sectionPlaneRef.current = null;
    }
    
    // Create new section plane at the calculated height
    // For 2D floor plan mode, use dir [0, 1, 0] to clip above the plane
    const plugin = initializeSectionPlanesPlugin();
    
    if (plugin) {
      try {
        sectionPlaneRef.current = plugin.createSectionPlane({
          id: `floor-clip-dynamic-${Date.now()}`,
          pos: [0, clipY, 0],
          dir: [0, 1, 0], // Points UP = clips everything above
          active: true,
        });
        console.log(`Section plane updated to Y=${clipY.toFixed(2)} (height: ${newHeight}m) [dir: UP]`);
        currentClipModeRef.current = 'floor';
        return;
      } catch (e) {
        console.debug('Failed to update section plane via plugin:', e);
      }
    }
    
    // Fallback: Create section plane directly on scene
    try {
      const SectionPlane = viewer.scene.SectionPlane || (window as any).SectionPlane;
      if (SectionPlane) {
        sectionPlaneRef.current = new SectionPlane(viewer.scene, {
          id: `floor-clip-dynamic-${Date.now()}`,
          pos: [0, clipY, 0],
          dir: [0, 1, 0], // Points UP = clips above
          active: true,
        });
        console.log(`Section plane updated (direct) to Y=${clipY.toFixed(2)} [dir: UP]`);
        currentClipModeRef.current = 'floor';
      }
    } catch (e) {
      console.debug('Failed to update section plane directly:', e);
    }
  }, [getXeokitViewer, calculateFloorBounds, initializeSectionPlanesPlugin]);

  // Apply ceiling clipping (3D solo mode) - convenience function  
  const applyCeilingClipping = useCallback((floorId: string) => {
    applySectionPlane(floorId, 'ceiling');
  }, [applySectionPlane]);

  // Remove section plane
  const removeSectionPlane = useCallback(() => {
    if (sectionPlaneRef.current) {
      try {
        if (sectionPlaneRef.current.destroy) {
          sectionPlaneRef.current.destroy();
        } else if (sectionPlaneRef.current.scene?.destroySectionPlane) {
          sectionPlaneRef.current.scene.destroySectionPlane(sectionPlaneRef.current.id);
        }
        console.log('Section plane removed');
      } catch (e) {
        console.debug('Error removing section plane:', e);
      }
      sectionPlaneRef.current = null;
      currentFloorIdRef.current = null;
      currentClipModeRef.current = null;
    }
  }, []);

  // Update clipping based on visible floors (for 3D ceiling clipping)
  const updateClipping = useCallback((visibleFloorIds: string[]) => {
    // Only apply clipping when exactly one floor is visible
    if (visibleFloorIds.length === 1) {
      const floorId = visibleFloorIds[0];
      
      // Only update if floor changed
      if (floorId !== currentFloorIdRef.current) {
        applySectionPlane(floorId);
      }
    } else {
      // Multiple or all floors visible - remove clipping
      if (currentFloorIdRef.current !== null) {
        removeSectionPlane();
      }
    }
  }, [applySectionPlane, removeSectionPlane]);

  // Get current floor bounds (for external use)
  const getCurrentFloorBounds = useCallback(() => {
    if (!currentFloorIdRef.current) return null;
    return calculateFloorBounds(currentFloorIdRef.current);
  }, [calculateFloorBounds]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      removeSectionPlane();
      
      if (sectionPlanesPluginRef.current?.destroy) {
        try {
          sectionPlanesPluginRef.current.destroy();
        } catch (e) {
          console.debug('Error destroying SectionPlanesPlugin:', e);
        }
      }
    };
  }, [removeSectionPlane]);

  return {
    updateClipping,
    applySectionPlane,
    applyFloorPlanClipping,
    applyGlobalFloorPlanClipping,
    applyCeilingClipping,
    removeSectionPlane,
    updateFloorCutHeight,
    calculateFloorBounds,
    getCurrentFloorBounds,
    isClippingActive: currentFloorIdRef.current !== null || currentClipModeRef.current !== null,
    currentFloorId: currentFloorIdRef.current,
    currentClipMode: currentClipModeRef.current,
    currentFloorCutHeight: floorCutHeightRef.current,
  };
}

export default useSectionPlaneClipping;
