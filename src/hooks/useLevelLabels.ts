/**
 * useLevelLabels — Floating level (storey) labels beside the 3D model.
 *
 * - Scans metaScene for IfcBuildingStorey objects
 * - Positions labels using hybrid screen-space approach (always left of building)
 * - Click-to-isolate: clicking a label directly applies scene visibility + dispatches event
 * - Active label shows an X close button to restore all floors
 * - Resolves friendly names from the database (same pattern as FloatingFloorSwitcher)
 */
import { useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FLOOR_SELECTION_CHANGED_EVENT, type FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';

interface LevelLabel {
  storeyId: string;          // metaObject id
  fmGuid: string;            // originalSystemId
  name: string;              // display name
  worldY: number;            // floor center elevation (world Y)
  element: HTMLDivElement;
  metaObjectIds: string[];   // all child meta-object ids for this storey
  childEntityIds: string[];  // all child entity ids (for visibility)
  databaseFmGuids: string[]; // matching database fm_guids
}

/** IFC types to hide when isolating a floor */
const OBSTRUCTING_TYPES = new Set(['ifccovering', 'ifcroof']);

export const LEVEL_LABELS_TOGGLE_EVENT = 'LEVEL_LABELS_TOGGLE';

export function useLevelLabels(
  viewerRef: React.MutableRefObject<any>,
  buildingFmGuid?: string
) {
  const labelsRef = useRef<Map<string, LevelLabel>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const enabledRef = useRef(false);
  const cameraListenerRef = useRef<(() => void) | null>(null);
  const activeStoreyIdRef = useRef<string | null>(null);
  const floorNamesRef = useRef<Map<string, string>>(new Map());
  /** Cached scene AABB for screen-space projection */
  const sceneAABBRef = useRef<number[] | null>(null);

  const getXeokitViewer = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    } catch { return null; }
  }, [viewerRef]);

  const getCanvas = useCallback(() => {
    const viewer = getXeokitViewer();
    return viewer?.scene?.canvas?.canvas as HTMLCanvasElement | null;
  }, [getXeokitViewer]);

  const ensureContainer = useCallback(() => {
    if (containerRef.current) return containerRef.current;
    const canvas = getCanvas();
    if (!canvas?.parentElement) return null;

    const container = document.createElement('div');
    container.id = 'level-labels-container';
    container.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; overflow: hidden; z-index: 11;
    `;
    canvas.parentElement.style.position = 'relative';
    canvas.parentElement.appendChild(container);
    containerRef.current = container;
    return container;
  }, [getCanvas]);

  /**
   * Project a 3D point → 2D canvas pixel coords.
   * Returns null if behind camera or far outside viewport.
   */
  const worldToScreen = useCallback((worldPos: number[], viewer: any): [number, number] | null => {
    if (!viewer?.scene?.canvas?.canvas) return null;
    const camera = viewer.camera;
    const canvas = viewer.scene.canvas.canvas;
    const vm = camera.viewMatrix;
    const pm = camera.projMatrix;
    if (!vm || !pm) return null;

    const vp = [
      vm[0]*worldPos[0] + vm[4]*worldPos[1] + vm[8]*worldPos[2] + vm[12],
      vm[1]*worldPos[0] + vm[5]*worldPos[1] + vm[9]*worldPos[2] + vm[13],
      vm[2]*worldPos[0] + vm[6]*worldPos[1] + vm[10]*worldPos[2] + vm[14],
      vm[3]*worldPos[0] + vm[7]*worldPos[1] + vm[11]*worldPos[2] + vm[15],
    ];
    const pp = [
      pm[0]*vp[0] + pm[4]*vp[1] + pm[8]*vp[2] + pm[12]*vp[3],
      pm[1]*vp[0] + pm[5]*vp[1] + pm[9]*vp[2] + pm[13]*vp[3],
      pm[2]*vp[0] + pm[6]*vp[1] + pm[10]*vp[2] + pm[14]*vp[3],
      pm[3]*vp[0] + pm[7]*vp[1] + pm[11]*vp[2] + pm[15]*vp[3],
    ];
    if (pp[3] <= 0) return null;
    const ndcX = pp[0] / pp[3];
    const ndcY = pp[1] / pp[3];
    if (ndcX < -2 || ndcX > 2 || ndcY < -2 || ndcY > 2) return null;
    return [
      ((ndcX + 1) / 2) * canvas.clientWidth,
      ((1 - ndcY) / 2) * canvas.clientHeight,
    ];
  }, []);

  // Fetch friendly floor names from DB
  useEffect(() => {
    if (!buildingFmGuid) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('assets')
          .select('fm_guid, name, common_name')
          .eq('building_fm_guid', buildingFmGuid)
          .eq('category', 'Building Storey');
        if (data) {
          const map = new Map<string, string>();
          data.forEach((row: any) => {
            const displayName = row.common_name || row.name || row.fm_guid;
            map.set(row.fm_guid.toLowerCase(), displayName);
          });
          floorNamesRef.current = map;
        }
      } catch (e) {
        console.debug('[level-labels] Could not fetch floor names:', e);
      }
    })();
  }, [buildingFmGuid]);

  /**
   * Compute the screen-space left edge of the building by projecting
   * all 8 AABB corners and finding the minimum screen X.
   */
  const getBuildingLeftScreenX = useCallback((viewer: any): number | null => {
    const aabb = sceneAABBRef.current;
    if (!aabb) return null;

    const [xMin, yMin, zMin, xMax, yMax, zMax] = aabb;
    const corners = [
      [xMin, yMin, zMin], [xMax, yMin, zMin],
      [xMin, yMax, zMin], [xMax, yMax, zMin],
      [xMin, yMin, zMax], [xMax, yMin, zMax],
      [xMin, yMax, zMax], [xMax, yMax, zMax],
    ];

    let minScreenX = Infinity;
    let anyProjected = false;
    for (const c of corners) {
      const sp = worldToScreen(c, viewer);
      if (sp) {
        minScreenX = Math.min(minScreenX, sp[0]);
        anyProjected = true;
      }
    }
    return anyProjected ? minScreenX : null;
  }, [worldToScreen]);

  /**
   * Update label positions using hybrid screen-space approach:
   * - X position: constant pixel offset left of building's screen-space left edge
   * - Y position: project the label's worldY to get screen Y
   */
  const updateLabelPositions = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer || !enabledRef.current) return;

    const leftEdge = getBuildingLeftScreenX(viewer);
    if (leftEdge === null) {
      // Can't project — hide all
      labelsRef.current.forEach(l => { l.element.style.display = 'none'; });
      return;
    }

    const labelScreenX = leftEdge - 20; // 20px offset from building edge

    // Use the center of the scene AABB for X and Z when projecting worldY
    const aabb = sceneAABBRef.current!;
    const centerX = (aabb[0] + aabb[3]) / 2;
    const centerZ = (aabb[2] + aabb[5]) / 2;

    labelsRef.current.forEach(label => {
      const sp = worldToScreen([centerX, label.worldY, centerZ], viewer);
      if (sp) {
        // Position: fixed pixel offset left of building, Y from world projection
        label.element.style.transform = `translate3d(${labelScreenX}px, ${sp[1]}px, 0) translate(-100%, -50%)`;
        if (label.element.style.display === 'none') label.element.style.display = 'flex';
      } else {
        if (label.element.style.display !== 'none') label.element.style.display = 'none';
      }
    });
  }, [getXeokitViewer, worldToScreen, getBuildingLeftScreenX]);

  /**
   * Recursively collect all child entity IDs of a metaObject.
   */
  const collectChildEntityIds = useCallback((metaObj: any, scene: any): string[] => {
    const ids: string[] = [];
    const walk = (parent: any) => {
      if (parent.children) {
        parent.children.forEach((child: any) => {
          ids.push(child.id);
          walk(child);
        });
      }
    };
    walk(metaObj);
    return ids;
  }, []);

  // Restore all floors (clear isolation)
  const restoreAllFloors = useCallback(() => {
    activeStoreyIdRef.current = null;

    // Restore scene visibility
    const viewer = getXeokitViewer();
    if (viewer?.scene) {
      viewer.scene.setObjectsVisible(viewer.scene.objectIds, true);
    }

    // Remove active states from all labels
    labelsRef.current.forEach(label => {
      label.element.classList.remove('level-label--active');
      const closeBtn = label.element.querySelector('.level-label-close');
      if (closeBtn) closeBtn.remove();
    });

    // Dispatch restore event
    window.dispatchEvent(new CustomEvent<FloorSelectionEventDetail>(FLOOR_SELECTION_CHANGED_EVENT, {
      detail: { floorId: null, isAllFloorsVisible: true },
    }));
  }, [getXeokitViewer]);

  // Isolate a single floor
  const isolateFloor = useCallback((label: LevelLabel) => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;
    const scene = viewer.scene;

    // Clear any previous active label
    labelsRef.current.forEach(l => {
      l.element.classList.remove('level-label--active');
      const closeBtn = l.element.querySelector('.level-label-close');
      if (closeBtn) closeBtn.remove();
    });

    activeStoreyIdRef.current = label.storeyId;
    label.element.classList.add('level-label--active');

    // --- Direct scene visibility ---
    // 1. Hide all objects
    scene.setObjectsVisible(scene.objectIds, false);

    // 2. Show only this storey's children
    const visibleIds = label.childEntityIds.filter(id => scene.objects?.[id]);
    if (visibleIds.length === 0) {
      // Safety: no geometry found, restore
      scene.setObjectsVisible(scene.objectIds, true);
      console.warn('[level-labels] No geometry found for floor, aborting isolation');
      return;
    }
    scene.setObjectsVisible(visibleIds, true);

    // 3. Hide obstructing types (IfcCovering, IfcRoof)
    const metaObjects = viewer.metaScene?.metaObjects;
    if (metaObjects) {
      const obstructingIds: string[] = [];
      visibleIds.forEach(id => {
        const mo = metaObjects[id];
        if (mo && OBSTRUCTING_TYPES.has(mo.type?.toLowerCase())) {
          obstructingIds.push(id);
        }
      });
      if (obstructingIds.length > 0) {
        scene.setObjectsVisible(obstructingIds, false);
      }
    }

    // Add close button
    const closeBtn = document.createElement('span');
    closeBtn.className = 'level-label-close';
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `
      margin-left: 6px; cursor: pointer; font-size: 10px; opacity: 0.7;
      pointer-events: auto; line-height: 1;
    `;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      restoreAllFloors();
    });
    label.element.appendChild(closeBtn);

    // Dispatch floor isolation event (sync other components)
    window.dispatchEvent(new CustomEvent<FloorSelectionEventDetail>(FLOOR_SELECTION_CHANGED_EVENT, {
      detail: {
        floorId: label.storeyId,
        floorName: label.name,
        visibleMetaFloorIds: label.metaObjectIds,
        visibleFloorFmGuids: label.databaseFmGuids,
        isAllFloorsVisible: false,
        isSoloFloor: true,
        soloFloorName: label.name,
      },
    }));
  }, [getXeokitViewer, restoreAllFloors]);

  // Create labels
  const createLabels = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects || !viewer?.scene) return;

    const container = ensureContainer();
    if (!container) return;

    // Clear existing
    labelsRef.current.forEach(l => l.element.remove());
    labelsRef.current.clear();

    const metaObjects = viewer.metaScene.metaObjects;
    const scene = viewer.scene;

    // Cache scene AABB
    sceneAABBRef.current = scene.aabb ? [...scene.aabb] : null;

    // Collect storeys
    const storeys: { metaObj: any; minY: number; maxY: number; childIds: string[] }[] = [];

    Object.values(metaObjects).forEach((metaObj: any) => {
      if (metaObj.type?.toLowerCase() !== 'ifcbuildingstorey') return;

      let minY = Infinity, maxY = -Infinity;
      const childIds: string[] = [];

      const collectChildren = (parent: any) => {
        if (parent.children) {
          parent.children.forEach((child: any) => {
            childIds.push(child.id);
            const entity = scene.objects?.[child.id];
            if (entity?.aabb) {
              minY = Math.min(minY, entity.aabb[1]);
              maxY = Math.max(maxY, entity.aabb[4]);
            }
            collectChildren(child);
          });
        }
      };
      collectChildren(metaObj);

      if (minY === Infinity) return; // No geometry found

      storeys.push({ metaObj, minY, maxY, childIds });
    });

    // Sort by elevation
    storeys.sort((a, b) => a.minY - b.minY);

    storeys.forEach(({ metaObj, minY, maxY, childIds }) => {
      const centerY = (minY + maxY) / 2;
      const fmGuid = metaObj.originalSystemId || metaObj.id;
      const fmGuidLower = fmGuid.toLowerCase();

      // Resolve display name
      const dbName = floorNamesRef.current.get(fmGuidLower);
      const displayName = dbName || metaObj.name || fmGuid.substring(0, 8);

      const databaseFmGuids = [fmGuid];

      // Create DOM element
      const el = document.createElement('div');
      el.className = 'level-label';
      el.textContent = displayName;
      el.style.cssText = `
        position: absolute; left: 0; top: 0;
        display: none; align-items: center; gap: 2px;
        background: hsl(var(--card) / 0.85);
        backdrop-filter: blur(6px);
        color: hsl(var(--card-foreground));
        padding: 3px 10px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 500;
        white-space: nowrap;
        pointer-events: auto;
        cursor: pointer;
        border: 1px solid hsl(var(--border) / 0.4);
        box-shadow: 0 1px 4px rgba(0,0,0,0.12);
        will-change: transform;
        transition: background 0.15s, border-color 0.15s;
        z-index: 11;
      `;

      const labelData: LevelLabel = {
        storeyId: metaObj.id,
        fmGuid,
        name: displayName,
        worldY: centerY,
        element: el,
        metaObjectIds: [metaObj.id, ...childIds],
        childEntityIds: childIds,
        databaseFmGuids,
      };

      // Click handler — isolate floor
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeStoreyIdRef.current === metaObj.id) {
          restoreAllFloors();
        } else {
          isolateFloor(labelData);
        }
      });

      // Hover effect
      el.addEventListener('mouseenter', () => {
        if (activeStoreyIdRef.current !== metaObj.id) {
          el.style.background = 'hsl(var(--primary) / 0.15)';
          el.style.borderColor = 'hsl(var(--primary) / 0.5)';
        }
      });
      el.addEventListener('mouseleave', () => {
        if (activeStoreyIdRef.current !== metaObj.id) {
          el.style.background = 'hsl(var(--card) / 0.85)';
          el.style.borderColor = 'hsl(var(--border) / 0.4)';
        }
      });

      container.appendChild(el);
      labelsRef.current.set(metaObj.id, labelData);
    });

    console.log(`[level-labels] Created ${labelsRef.current.size} level labels`);
    updateLabelPositions();
  }, [getXeokitViewer, ensureContainer, updateLabelPositions, isolateFloor, restoreAllFloors]);

  // Destroy labels
  const destroyLabels = useCallback(() => {
    labelsRef.current.forEach(l => l.element.remove());
    labelsRef.current.clear();
    activeStoreyIdRef.current = null;

    if (containerRef.current) {
      containerRef.current.remove();
      containerRef.current = null;
    }

    if (cameraListenerRef.current) {
      const viewer = getXeokitViewer();
      if (viewer?.scene?.camera) {
        viewer.scene.camera.off(cameraListenerRef.current);
      }
      cameraListenerRef.current = null;
    }
  }, [getXeokitViewer]);

  // Public API
  const setLabelsEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;
    if (enabled) {
      createLabels();
      // Start camera listener
      const viewer = getXeokitViewer();
      if (viewer?.scene?.camera && !cameraListenerRef.current) {
        let rafId = 0;
        const throttledUpdate = () => {
          if (rafId) return;
          rafId = requestAnimationFrame(() => {
            rafId = 0;
            updateLabelPositions();
          });
        };
        cameraListenerRef.current = viewer.scene.camera.on('matrix', throttledUpdate);
      }
    } else {
      destroyLabels();
    }
  }, [createLabels, destroyLabels, getXeokitViewer, updateLabelPositions]);

  const refreshLabels = useCallback(() => {
    if (enabledRef.current) {
      createLabels();
    }
  }, [createLabels]);

  // Listen for external toggle events
  useEffect(() => {
    const handler = (e: CustomEvent<{ enabled: boolean }>) => {
      setLabelsEnabled(e.detail.enabled);
    };
    window.addEventListener(LEVEL_LABELS_TOGGLE_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(LEVEL_LABELS_TOGGLE_EVENT, handler as EventListener);
    };
  }, [setLabelsEnabled]);

  // Listen for floor selection from other components to sync active state
  useEffect(() => {
    const handler = (e: CustomEvent<FloorSelectionEventDetail>) => {
      if (e.detail.isAllFloorsVisible) {
        activeStoreyIdRef.current = null;
        labelsRef.current.forEach(l => {
          l.element.classList.remove('level-label--active');
          const closeBtn = l.element.querySelector('.level-label-close');
          if (closeBtn) closeBtn.remove();
        });
      }
    };
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => { destroyLabels(); };
  }, [destroyLabels]);

  return { setLabelsEnabled, refreshLabels };
}
