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

  // Create or update horizontal section plane
  const applySectionPlane = useCallback((floorId: string, mode?: ClipMode) => {
    if (!enabled) return;

    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;

    const bounds = calculateFloorBounds(floorId);
    if (!bounds) {
      console.debug('Could not calculate bounds for floor clipping:', floorId);
      return;
    }

    const effectiveMode = mode || clipMode;
    const floorCutHeight = floorCutHeightRef.current;
    
    // Calculate clip height based on mode
    // 'ceiling': clips at ceiling level (hides objects above floor ceiling)
    // 'floor': clips ~1.2m above floor (creates floor plan view)
    const clipHeight = effectiveMode === 'floor' 
      ? bounds.minY + floorCutHeight  // Floor plan: height above floor
      : bounds.maxY + offset;          // Ceiling: at ceiling level + offset
    
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
        // Create horizontal section plane pointing downward (clips everything above)
        sectionPlaneRef.current = plugin.createSectionPlane({
          id: `floor-clip-${floorId}-${effectiveMode}`,
          pos: [0, clipHeight, 0],
          dir: [0, -1, 0], // Points down, clips above
          active: true,
        });
        
        const modeLabel = effectiveMode === 'floor' ? '2D planritning' : 'taknivå';
        console.log(`Section plane created at Y=${clipHeight.toFixed(2)} (${modeLabel}) for floor: ${bounds.name}`);
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
      
      if (SectionPlane) {
        sectionPlaneRef.current = new SectionPlane(viewer.scene, {
          id: `floor-clip-${floorId}-${effectiveMode}`,
          pos: [0, clipHeight, 0],
          dir: [0, -1, 0],
          active: true,
        });
        
        const modeLabel = effectiveMode === 'floor' ? '2D planritning' : 'taknivå';
        console.log(`Section plane created (direct) at Y=${clipHeight.toFixed(2)} (${modeLabel}) for floor: ${bounds.name}`);
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
  }, [enabled, offset, clipMode, getXeokitViewer, calculateFloorBounds, initializeSectionPlanesPlugin]);

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
          dir: [0, -1, 0],
          active: true,
        });
        
        console.log(`Global section plane created at Y=${clipHeight.toFixed(2)} (2D planritning)`);
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
          dir: [0, -1, 0],
          active: true,
        });
        
        console.log(`Global section plane created (direct) at Y=${clipHeight.toFixed(2)}`);
        currentFloorIdRef.current = null;
        currentClipModeRef.current = 'floor';
      }
    } catch (e) {
      console.debug('Failed to create global section plane directly:', e);
    }
  }, [enabled, getXeokitViewer, initializeSectionPlanesPlugin]);

  // Update floor cut height dynamically
  const updateFloorCutHeight = useCallback((newHeight: number) => {
    floorCutHeightRef.current = newHeight;
    
    // Get viewer and scene info
    const viewer = getXeokitViewer();
    if (!viewer?.scene) {
      console.debug('No viewer available for clip height update');
      return;
    }
    
    // Re-apply clipping if currently in floor mode OR if we should be in floor mode
    // This allows the slider to work even if the mode wasn't set properly
    if (currentClipModeRef.current === 'floor') {
      if (currentFloorIdRef.current) {
        applySectionPlane(currentFloorIdRef.current, 'floor');
      } else {
        // Global clipping - get scene base and re-apply
        const sceneAABB = viewer.scene?.getAABB?.();
        if (sceneAABB) {
          applyGlobalFloorPlanClipping(sceneAABB[1]);
        }
      }
    } else {
      // Even if mode isn't set to 'floor', if we're adjusting clip height,
      // the user probably wants floor clipping. Apply global clipping.
      console.log('Clip height changed but mode was not floor, applying global clipping');
      const sceneAABB = viewer.scene?.getAABB?.();
      if (sceneAABB) {
        applyGlobalFloorPlanClipping(sceneAABB[1]);
      }
    }
  }, [applySectionPlane, getXeokitViewer, applyGlobalFloorPlanClipping]);

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
