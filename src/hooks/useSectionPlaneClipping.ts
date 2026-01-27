import { useRef, useCallback, useEffect } from 'react';

interface FloorBounds {
  id: string;
  name: string;
  minY: number;
  maxY: number;
  metaObjectIds: string[];
}

interface SectionPlaneClippingOptions {
  enabled?: boolean;
  offset?: number; // Extra height above floor ceiling for clipping
}

/**
 * Hook for managing horizontal SectionPlane clipping at floor boundaries.
 * 
 * When a single floor is selected, this creates a horizontal clipping plane
 * at the floor's ceiling height to cut off any objects that incorrectly
 * extend beyond the floor boundaries.
 */
export function useSectionPlaneClipping(
  viewerRef: React.MutableRefObject<any>,
  options: SectionPlaneClippingOptions = {}
) {
  const { enabled = true, offset = 0.05 } = options;
  const sectionPlaneRef = useRef<any>(null);
  const sectionPlanesPluginRef = useRef<any>(null);
  const currentFloorIdRef = useRef<string | null>(null);

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

  // Create or update horizontal section plane at floor ceiling
  const applySectionPlane = useCallback((floorId: string) => {
    if (!enabled) return;

    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;

    const bounds = calculateFloorBounds(floorId);
    if (!bounds) {
      console.debug('Could not calculate bounds for floor clipping:', floorId);
      return;
    }

    const ceilingHeight = bounds.maxY + offset;
    
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
          id: `floor-clip-${floorId}`,
          pos: [0, ceilingHeight, 0],
          dir: [0, -1, 0], // Points down, clips above
          active: true,
        });
        
        console.log(`Section plane created at Y=${ceilingHeight.toFixed(2)} for floor: ${bounds.name}`);
        currentFloorIdRef.current = floorId;
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
          id: `floor-clip-${floorId}`,
          pos: [0, ceilingHeight, 0],
          dir: [0, -1, 0],
          active: true,
        });
        
        console.log(`Section plane created (direct) at Y=${ceilingHeight.toFixed(2)} for floor: ${bounds.name}`);
        currentFloorIdRef.current = floorId;
      } else {
        // Ultimate fallback: Use xeokit scene's sectionPlanes directly
        const sectionPlanes = viewer.scene.sectionPlanes;
        if (sectionPlanes) {
          const planeId = `floor-clip-${floorId}`;
          
          // Create a new section plane using scene API
          viewer.scene.createSectionPlane?.({
            id: planeId,
            pos: [0, ceilingHeight, 0],
            dir: [0, -1, 0],
            active: true,
          });
          
          sectionPlaneRef.current = { id: planeId, scene: viewer.scene };
          console.log(`Section plane created (scene API) at Y=${ceilingHeight.toFixed(2)}`);
          currentFloorIdRef.current = floorId;
        }
      }
    } catch (e) {
      console.debug('Failed to create section plane directly:', e);
    }
  }, [enabled, offset, getXeokitViewer, calculateFloorBounds, initializeSectionPlanesPlugin]);

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
    }
  }, []);

  // Update clipping based on visible floors
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
    removeSectionPlane,
    isClippingActive: currentFloorIdRef.current !== null,
    currentFloorId: currentFloorIdRef.current,
  };
}

export default useSectionPlaneClipping;
