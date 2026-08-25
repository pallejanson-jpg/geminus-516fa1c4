import { useRef, useCallback, useEffect } from 'react';
import { logger } from '@/lib/logger';

// Cached SectionPlane constructor extracted from the bundled xeokit UMD
let cachedSectionPlaneClass: any = null;

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
  offset?: number;
  clipMode?: ClipMode;
  floorCutHeight?: number;
}

// Custom event names
export const FLOOR_SELECTION_CHANGED_EVENT = 'FLOOR_SELECTION_CHANGED';
export const VIEW_MODE_CHANGED_EVENT = 'VIEW_MODE_CHANGED';
export const CLIP_HEIGHT_CHANGED_EVENT = 'CLIP_HEIGHT_CHANGED';
export const CLIP_HEIGHT_3D_CHANGED_EVENT = 'CLIP_HEIGHT_3D_CHANGED';

export interface FloorSelectionEventDetail {
  floorId: string | null;
  floorName?: string | null;
  bounds?: { minY: number; maxY: number } | null;
  visibleMetaFloorIds?: string[];
  visibleFloorFmGuids?: string[];
  isAllFloorsVisible?: boolean;
  isSoloFloor?: boolean;
  soloFloorName?: string;
  /** When true, listeners should NOT apply section-plane clipping (visibility already handled). */
  skipClipping?: boolean;
}

export interface ViewModeEventDetail {
  mode: '2d' | '3d';
  floorId?: string | null;
}

export interface ClipHeightEventDetail {
  height: number;
}

export interface ClipHeight3DEventDetail {
  offset: number;
}

/**
 * Diagnose what the GeminusPlusViewer UMD bundle exposes on the xeokit scene.
 * Call this after viewer init to understand available APIs.
 */
export function diagnoseXeokitScene(viewer: any) {
  if (!viewer?.scene) {
    logger.warn('[SectionPlane Diag] No scene available');
    return;
  }
  const scene = viewer.scene;
  
  // Log component types
  const components = scene.components || {};
  const typeSet = new Set<string>();
  Object.values(components).forEach((c: any) => {
    if (c?.constructor?.name) typeSet.add(c.constructor.name);
    if (c?.type) typeSet.add(`type:${c.type}`);
  });
  logger.log('[SectionPlane Diag] Scene component types:', [...typeSet]);
  logger.log('[SectionPlane Diag] scene.sectionPlanes:', Object.keys(scene.sectionPlanes || {}));
  logger.log('[SectionPlane Diag] scene._sectionPlanesState:', !!scene._sectionPlanesState);
  
  // Check for SectionPlane class on scene prototype chain
  logger.log('[SectionPlane Diag] scene.SectionPlane:', !!scene.SectionPlane);
  
  // Check viewer plugins
  const plugins = viewer.plugins || {};
  logger.log('[SectionPlane Diag] Viewer plugins:', Object.keys(plugins));
  
  // Try to find SectionPlane constructor from existing components
  const spClass = extractSectionPlaneClass(viewer);
  logger.log('[SectionPlane Diag] Extracted SectionPlane class:', !!spClass, spClass?.name || 'unknown');
}

/**
 * Extract the SectionPlane constructor from the bundled xeokit viewer.
 * Strategy: Find any existing SectionPlane component or create one temporarily
 * to capture the constructor for reuse.
 */
function extractSectionPlaneClass(viewer: any): any {
  if (cachedSectionPlaneClass) return cachedSectionPlaneClass;
  
  const scene = viewer?.scene;
  if (!scene) return null;

  // Strategy 1: Check global scope
  const globalClass = (window as any).__xeokitSectionPlaneClass || (window as any).xeokit?.SectionPlane || (window as any).SectionPlane;
  if (globalClass) {
    cachedSectionPlaneClass = globalClass;
    logger.log('[SectionPlane] Found class globally');
    return globalClass;
  }

  // Strategy 2: Find existing SectionPlane instance and grab its constructor
  const existingPlanes = scene.sectionPlanes || {};
  for (const plane of Object.values(existingPlanes)) {
    if ((plane as any)?.constructor) {
      cachedSectionPlaneClass = (plane as any).constructor;
      logger.log('[SectionPlane] Extracted class from existing plane');
      return cachedSectionPlaneClass;
    }
  }

  // Strategy 3: Search all components for type === "SectionPlane"
  const components = scene.components || {};
  for (const comp of Object.values(components)) {
    if ((comp as any)?.type === 'SectionPlane' && (comp as any)?.constructor) {
      cachedSectionPlaneClass = (comp as any).constructor;
      logger.log('[SectionPlane] Extracted class from component registry');
      return cachedSectionPlaneClass;
    }
  }

  // Strategy 4: Check SectionPlanesPlugin if available
  const plugins = viewer.plugins || {};
  for (const plugin of Object.values(plugins)) {
    if ((plugin as any)?.sectionPlanes) {
      for (const sp of Object.values((plugin as any).sectionPlanes)) {
        if ((sp as any)?.constructor) {
          cachedSectionPlaneClass = (sp as any).constructor;
          logger.log('[SectionPlane] Extracted class from plugin');
          return cachedSectionPlaneClass;
        }
      }
    }
  }

  return null;
}

/**
 * Hook for managing horizontal SectionPlane clipping at floor boundaries.
 * 
 * xeokit SectionPlane semantics:
 * - dir points toward the DISCARDED half-space
 * - dir [0, 1, 0] = discard above (show below)
 * - dir [0, -1, 0] = discard below (show above)
 */
export function useSectionPlaneClipping(
  viewerRef: React.MutableRefObject<any>,
  options: SectionPlaneClippingOptions = {}
) {
  const { enabled = true, offset: initialOffset = 0.05, clipMode = 'ceiling', floorCutHeight: initialFloorCutHeight = 1.2 } = options;
  
  const topPlaneRef = useRef<any>(null);
  const bottomPlaneRef = useRef<any>(null);
  const ceilingPlaneRef = useRef<any>(null);
  
  const currentFloorIdRef = useRef<string | null>(null);
  const currentClipModeRef = useRef<ClipMode | null>(null);
  const floorCutHeightRef = useRef<number>(initialFloorCutHeight);
  const currentFloorMinYRef = useRef<number>(0);
  const ceiling3DOffsetRef = useRef<number>(initialOffset);
  const nextFloorMinYRef = useRef<number | null>(null);
  const diagRanRef = useRef(false);

  const getXeokitViewer = useCallback(() => {
    try {
      const v = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      if (v?.scene) return v;
      // Fallback: use globally exposed viewer instance
      return (window as any).__nativeXeokitViewer || null;
    } catch (e) {
      return (window as any).__nativeXeokitViewer || null;
    }
  }, [viewerRef]);

  /**
   * Ensure all entities are clippable (required for SectionPlanes to work)
   */
  const ensureAllEntitiesClippable = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;
    const scene = viewer.scene;
    const allIds = scene.objectIds;
    if (allIds?.length > 0) {
      try {
        scene.setObjectsClippable(allIds, true);
      } catch {
        // Fallback: per-entity loop if batch API not available
        Object.values(scene.objects || {}).forEach((entity: any) => {
          if (entity?.clippable === false) entity.clippable = true;
        });
      }
    }
  }, [getXeokitViewer]);

  /**
   * Create a SectionPlane using multiple fallback strategies.
   * 
   * Priority order:
   * 1. Use extracted SectionPlane constructor (new SectionPlane(scene, cfg))
   * 2. Use SectionPlanesPlugin.createSectionPlane()
   * 3. Use scene._sectionPlanesState low-level manipulation
   */
  const createSectionPlane = useCallback((
    id: string,
    pos: [number, number, number],
    dir: [number, number, number]
  ): any => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene) {
      logger.warn('[SectionPlane] No viewer/scene available');
      return null;
    }
    const scene = viewer.scene;

    // Run diagnostics once
    if (!diagRanRef.current) {
      diagRanRef.current = true;
      diagnoseXeokitScene(viewer);
    }

    // First: destroy any existing plane with same id
    const existing = scene.sectionPlanes?.[id];
    if (existing) {
      try { existing.destroy?.(); } catch (e) { /* ignore */ }
    }

    // Method 0: Use scene.createSectionPlane() if available (some xeokit builds expose it)
    if (typeof scene.createSectionPlane === 'function') {
      try {
        const plane = scene.createSectionPlane({ id, pos, dir, active: true });
        logger.log(`✅ SectionPlane via scene.createSectionPlane: ${id} at Y=${pos[1].toFixed(2)}, dir=[${dir}]`);
        return plane;
      } catch (e) {
        logger.warn('[SectionPlane] scene.createSectionPlane failed:', e);
      }
    }

    // Method 1: Use extracted SectionPlane constructor
    const SectionPlaneClass = extractSectionPlaneClass(viewer);
    if (SectionPlaneClass) {
      try {
        const plane = new SectionPlaneClass(scene, { id, pos, dir, active: true });
        logger.log(`✅ SectionPlane created via constructor: ${id} at Y=${pos[1].toFixed(2)}, dir=[${dir}]`);
        return plane;
      } catch (e) {
        logger.warn('[SectionPlane] Constructor creation failed:', e);
      }
    }

    // Method 2: Check for SectionPlanesPlugin on viewer
    const plugins = viewer.plugins || {};
    for (const plugin of Object.values(plugins)) {
      if (typeof (plugin as any)?.createSectionPlane === 'function') {
        try {
          const plane = (plugin as any).createSectionPlane({ id, pos, dir, active: true });
          logger.log(`✅ SectionPlane created via plugin: ${id} at Y=${pos[1].toFixed(2)}, dir=[${dir}]`);
          return plane;
        } catch (e) {
          logger.warn('[SectionPlane] Plugin creation failed:', e);
        }
      }
    }

    // Method 3: Try global SectionPlanesPlugin class
    const SPPlugin = (window as any).xeokit?.SectionPlanesPlugin || (window as any).SectionPlanesPlugin;
    if (SPPlugin) {
      try {
        const tempPlugin = new SPPlugin(viewer, { id: 'lovable-sp-plugin' });
        const plane = tempPlugin.createSectionPlane({ id, pos, dir, active: true });
        logger.log(`✅ SectionPlane created via new SectionPlanesPlugin: ${id} at Y=${pos[1].toFixed(2)}`);
        return plane;
      } catch (e) {
        logger.warn('[SectionPlane] Global SectionPlanesPlugin failed:', e);
      }
    }

    // Method 4: Low-level _sectionPlanesState manipulation
    const state = scene._sectionPlanesState;
    if (state) {
      try {
        if (!state.sectionPlanes) state.sectionPlanes = [];
        
        const existingIndex = state.sectionPlanes.findIndex((p: any) => p?.id === id);
        if (existingIndex >= 0) state.sectionPlanes.splice(existingIndex, 1);
        
        const planeIndex = state.sectionPlanes.length;
        state.sectionPlanes.push({ pos: [...pos], dir: [...dir], active: true, id });
        state.numSectionPlanes = state.sectionPlanes.length;

        const plane = {
          id,
          _pos: [...pos] as [number, number, number],
          dir: [...dir] as [number, number, number],
          active: true,
          _stateIndex: planeIndex,
          set pos(newPos: [number, number, number]) {
            this._pos = [...newPos] as [number, number, number];
            const entry = state.sectionPlanes?.[this._stateIndex];
            if (entry) entry.pos = [...newPos];
            scene.glRedraw?.();
          },
          get pos() { return this._pos; },
          destroy: () => {
            const idx = state.sectionPlanes?.findIndex((p: any) => p?.id === id);
            if (idx >= 0) {
              state.sectionPlanes.splice(idx, 1);
              state.numSectionPlanes = state.sectionPlanes.length;
            }
            try { scene.fire?.("sectionPlaneDestroyed", { id }); } catch { /* ignore */ }
            scene.glRedraw?.();
          }
        };

        // Fire event to trigger xeokit's internal GPU clipping pipeline
        try { scene.fire?.("sectionPlaneCreated", plane); } catch { /* ignore */ }
        scene.glRedraw?.();
        logger.log(`✅ SectionPlane via _sectionPlanesState: ${id} at Y=${pos[1].toFixed(2)}`);
        return plane;
      } catch (e) {
        logger.warn('[SectionPlane] _sectionPlanesState failed:', e);
      }
    }

    // All methods exhausted — log diagnostic summary
    console.error(
      `❌ Could not create SectionPlane "${id}" — all methods failed.\n` +
      `  scene.createSectionPlane: ${typeof scene.createSectionPlane}\n` +
      `  SectionPlaneClass: ${!!extractSectionPlaneClass(viewer)}\n` +
      `  Plugins: ${Object.keys(viewer.plugins || {}).join(', ') || 'none'}\n` +
      `  _sectionPlanesState: ${!!scene._sectionPlanesState}\n` +
      `  Run diagnoseXeokitScene() for full details.`
    );
    return null;
  }, [getXeokitViewer]);

  const destroyPlane = useCallback((planeRef: React.MutableRefObject<any>) => {
    if (planeRef.current) {
      try { planeRef.current.destroy?.(); } catch (e) { /* ignore */ }
      planeRef.current = null;
    }
  }, []);

  const removeAllClippingPlanes = useCallback(() => {
    destroyPlane(topPlaneRef);
    destroyPlane(bottomPlaneRef);
    destroyPlane(ceilingPlaneRef);
    
    const viewer = getXeokitViewer();
    if (viewer?.scene?.sectionPlanes) {
      Object.keys(viewer.scene.sectionPlanes).forEach(planeId => {
        if (planeId.startsWith('floor-clip-') || planeId.startsWith('2d-') || planeId.startsWith('3d-ceiling-')) {
          try { viewer.scene.sectionPlanes[planeId].destroy?.(); } catch (e) { /* ignore */ }
        }
      });
    }
  }, [destroyPlane, getXeokitViewer]);

  const calculateFloorBounds = useCallback((floorId: string): FloorBounds | null => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects || !viewer?.scene?.objects) return null;

    const metaObjects = viewer.metaScene.metaObjects;
    const scene = viewer.scene;
    const floorMeta = metaObjects[floorId];
    if (!floorMeta) return null;

    // ── Strategy A: traverse hierarchy children ──────────────────────────
    const getAllChildIds = (metaObj: any): string[] => {
      const ids: string[] = [metaObj.id];
      (metaObj.children || []).forEach((child: any) => {
        ids.push(...getAllChildIds(child));
      });
      return ids;
    };

    const childIds = getAllChildIds(floorMeta);
    let minY = Infinity, maxY = -Infinity;
    let hasValidBounds = false;

    childIds.forEach(id => {
      const entity = scene.objects[id];
      if (entity?.aabb) {
        if (entity.aabb[1] < minY) minY = entity.aabb[1];
        if (entity.aabb[4] > maxY) maxY = entity.aabb[4];
        hasValidBounds = true;
      }
    });

    if (hasValidBounds) {
      return { id: floorId, name: floorMeta.name || 'Floor', minY, maxY, metaObjectIds: childIds };
    }

    // ── Strategy B: parent-traversal upward ──────────────────────────────
    const byStorey = new Map<string, { minY: number; maxY: number }>();
    Object.values(metaObjects).forEach((mo: any) => {
      const entity = scene.objects[mo.id];
      if (!entity?.aabb) return;
      let cur: any = mo;
      while (cur && cur.type?.toLowerCase() !== 'ifcbuildingstorey') cur = cur.parent;
      if (!cur?.id) return;
      const prev = byStorey.get(cur.id) ?? { minY: Infinity, maxY: -Infinity };
      byStorey.set(cur.id, {
        minY: Math.min(prev.minY, entity.aabb[1]),
        maxY: Math.max(prev.maxY, entity.aabb[4]),
      });
    });

    if (byStorey.has(floorId)) {
      const b = byStorey.get(floorId)!;
      return { id: floorId, name: floorMeta.name || 'Floor', minY: b.minY, maxY: b.maxY, metaObjectIds: childIds };
    }

    // ── Strategy C: Y-histogram clustering (flat IFC hierarchy fallback) ─
    // Cluster entity bottom-Y values to detect floor bands, then map
    // each band to a storey by sort order.
    const bottomYs: number[] = [];
    Object.values(scene.objects).forEach((entity: any) => {
      if (!entity?.aabb) return;
      const h = entity.aabb[4] - entity.aabb[1];
      // More lenient: include more entities to improve histogram accuracy
      if (h < 0.1 || h > 20) return; // skip only very trivial and full-building elements
      bottomYs.push(entity.aabb[1]);
    });

    // More lenient threshold: allow histogram with fewer entities
    if (bottomYs.length < 10) return null;

    bottomYs.sort((a, b) => a - b);
    const BUCKET = 0.25; // 25 cm buckets
    const histMin = bottomYs[0];
    const bucketCount = Math.ceil((bottomYs[bottomYs.length - 1] - histMin) / BUCKET) + 1;
    const hist = new Array(bucketCount).fill(0);
    bottomYs.forEach(y => hist[Math.floor((y - histMin) / BUCKET)]++);

    const MIN_ENTITIES = Math.max(5, Math.floor(bottomYs.length / 80));
    const peaks: number[] = [];
    for (let i = 1; i < hist.length - 1; i++) {
      if (hist[i] >= MIN_ENTITIES && hist[i] >= hist[i - 1] && hist[i] >= hist[i + 1]) {
        // Only keep if at least 1m from previous peak (avoid duplicates)
        const peakY = histMin + (i + 0.5) * BUCKET;
        if (peaks.length === 0 || peakY - peaks[peaks.length - 1] > 1.0) {
          peaks.push(peakY);
        }
      }
    }

    // ── Storey ordering ───────────────────────────────────────────────────
    // Deduplicate by name (multiple IFC models produce duplicate storeys).
    // Then sort in PHYSICAL order (bottom → top):
    //   U-prefix (underground) first, then numbered floors (01, 02…),
    //   then Havnivå/named floors alphabetically, then Tak (roof) last.
    const physicalOrder = (name: string): number => {
      const n = (name || '').trim();
      const upper = n.toUpperCase();
      if (/^U\d/i.test(n)) return -1000 + parseInt(n.match(/\d+/)?.[0] ?? '0', 10); // underground
      const numMatch = n.match(/^(\d+)/);
      if (numMatch) return parseInt(numMatch[1], 10); // "01 Etasje" → 1
      if (upper.startsWith('HAV')) return 500; // Havnivå — between basement and ground
      if (upper.startsWith('TAK') || upper.startsWith('ROOF')) return 9000; // roof
      return 5000; // other named floors between floors and roof
    };

    const seenNames = new Set<string>();
    const uniqueStoreys = (Object.values(metaObjects) as any[])
      .filter((mo: any) => mo?.type?.toLowerCase() === 'ifcbuildingstorey')
      .sort((a: any, b: any) => physicalOrder(a.name) - physicalOrder(b.name))
      .filter((mo: any) => {
        const key = (mo.name || '').toLowerCase().trim();
        if (seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
      });

    // If no clear peaks found, create a simple linear distribution
    if (peaks.length === 0) {
      // Fallback: distribute floors evenly across the Y range
      const minY = Math.min(...bottomYs);
      const maxY = Math.max(...bottomYs);
      const range = maxY - minY;
      const avgFloorHeight = Math.max(3, range / (uniqueStoreys.length || 5));

      // Find this storey's index in the ordered list
      const storeyIndex = uniqueStoreys.findIndex((s: any) => s.id === floorId);
      if (storeyIndex >= 0) {
        const floorMinY = minY + (storeyIndex * avgFloorHeight);
        const floorMaxY = floorMinY + avgFloorHeight;
        logger.log(`[calculateFloorBounds] No peaks found - using linear distribution: storey ${storeyIndex}/${uniqueStoreys.length}, Y=[${floorMinY.toFixed(2)}, ${floorMaxY.toFixed(2)}]`);
        return { id: floorId, name: floorMeta.name || 'Floor', minY: floorMinY, maxY: floorMaxY, metaObjectIds: [] };
      }
      return null;
    }

    // ── Debug: log all storeys once ───────────────────────────────────────
    if (!(window as any).__storeyDebugLogged) {
      (window as any).__storeyDebugLogged = true;
      const allS = (Object.values(metaObjects) as any[])
        .filter((mo: any) => mo?.type?.toLowerCase() === 'ifcbuildingstorey')
        .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '', 'no'));
      console.table(allS.map((s: any, i: number) => ({
        idx: i,
        id: s.id,
        name: s.name || '(no name)',
        model: s.metaModel?.id?.slice(0, 12) || '?',
      })));
      logger.log('[2D] Histogram peaks (floor Y levels):', peaks.map((p: number) => p.toFixed(2)));
    }


    // ── Map this storey to its Y-position, then match to nearest peak ───────
    // Simpler approach: just use the storey's own AABB if available

    try {
      // Try to get Y position from this storey's own entities
      let storeyMinY = Infinity;
      let entityCount = 0;

      Object.entries(scene.objects || {}).forEach(([sceneId, sceneObj]: [string, any]) => {
        if (!sceneObj?.aabb) return;

        const metaObj = metaObjects[sceneId];
        if (!metaObj) return;

        // Check if this entity belongs to target storey via parent chain
        let cur: any = metaObj;
        for (let i = 0; i < 50; i++) {
          if (!cur) break;
          if (cur.id === floorId) {
            storeyMinY = Math.min(storeyMinY, sceneObj.aabb[1]);
            entityCount++;
            break;
          }
          cur = cur.parent;
        }
      });

      if (storeyMinY === Infinity) {
        logger.warn(`[calculateFloorBounds] No entities found for storey ${floorId}. Using fallback.`);
        // Fallback: use first peak if we have any
        if (peaks.length === 0) return null;
        const floorMinY = peaks[0];
        const floorMaxY = peaks.length > 1 ? peaks[1] : floorMinY + 4.0;
        return { id: floorId, name: floorMeta.name || 'Floor', minY: floorMinY, maxY: floorMaxY, metaObjectIds: [] };
      }

      // Find nearest peak to this storey's Y
      let nearestPeakIdx = 0;
      let minDist = Math.abs(peaks[0] - storeyMinY);
      for (let i = 1; i < peaks.length; i++) {
        const dist = Math.abs(peaks[i] - storeyMinY);
        if (dist < minDist) {
          minDist = dist;
          nearestPeakIdx = i;
        }
      }

      const floorMinY = peaks[nearestPeakIdx];
      const floorMaxY = nearestPeakIdx < peaks.length - 1 ? peaks[nearestPeakIdx + 1] : floorMinY + 4.0;

      logger.log(`[calculateFloorBounds] Found ${entityCount} entities, Y=${storeyMinY.toFixed(2)} → peak ${nearestPeakIdx} [${floorMinY.toFixed(2)}, ${floorMaxY.toFixed(2)}]`);
      return { id: floorId, name: floorMeta.name || 'Floor', minY: floorMinY, maxY: floorMaxY, metaObjectIds: [] };
    } catch (e) {
      logger.warn(`[calculateFloorBounds] Error: ${e}`);
      return null;
    }
  }, [getXeokitViewer]);

  /**
   * Find the bottom of slab entities (IfcSlab etc.) on a given storey.
   * Returns the lowest AABB minY among all slab-type children, or null if none found.
   */
  const findSlabBottomY = useCallback((storeyId: string): number | null => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects || !viewer?.scene?.objects) return null;

    const SLAB_TYPES = new Set(['ifcslab', 'ifcslabstandardcase', 'ifcslabelementedcase', 'ifcplate']);
    const storeyMeta = viewer.metaScene.metaObjects[storeyId];
    if (!storeyMeta) return null;

    const scene = viewer.scene;
    let slabMinY = Infinity;
    let found = false;

    const walkChildren = (metaObj: any) => {
      if (SLAB_TYPES.has((metaObj.type || '').toLowerCase())) {
        const entity = scene.objects[metaObj.id];
        if (entity?.aabb) {
          const entityMinY = entity.aabb[1]; // AABB minY = bottom of slab
          if (entityMinY < slabMinY) slabMinY = entityMinY;
          found = true;
        }
      }
      (metaObj.children || []).forEach((child: any) => walkChildren(child));
    };

    (storeyMeta.children || []).forEach((child: any) => walkChildren(child));
    return found ? slabMinY : null;
  }, [getXeokitViewer]);

  const calculateClipHeightFromFloorBoundary = useCallback((floorId: string): { clipHeight: number; nextFloorMinY: number | null } | null => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects) return null;

    // Determine which model the target floor belongs to
    const targetMeta = viewer.metaScene.metaObjects[floorId];
    const targetModelId = targetMeta?.metaModel?.id || '';

    // Collect all storeys, preferring same-model storeys for next-floor calculation
    const allStoreys: { id: string; name: string; minY: number; maxY: number; modelId: string }[] = [];
    Object.values(viewer.metaScene.metaObjects).forEach((metaObj: any) => {
      if (metaObj.type?.toLowerCase() !== 'ifcbuildingstorey') return;
      const bounds = calculateFloorBounds(metaObj.id);
      if (bounds) allStoreys.push({ id: metaObj.id, name: bounds.name, minY: bounds.minY, maxY: bounds.maxY, modelId: metaObj.metaModel?.id || '' });
    });

    if (allStoreys.length === 0) return null;

    // Deduplicate storeys by name — keep only one per unique name
    // Prefer storeys from the same model as the target floor
    const byName = new Map<string, typeof allStoreys[0]>();
    allStoreys.forEach(s => {
      const key = s.name.toLowerCase().trim();
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, s);
      } else if (s.modelId === targetModelId && existing.modelId !== targetModelId) {
        byName.set(key, s); // Prefer same model
      }
    });

    const storeys = Array.from(byName.values());
    storeys.sort((a, b) => a.minY - b.minY);

    // Find current floor — match by ID or by name (for cross-model matching)
    let currentIndex = storeys.findIndex(s => s.id === floorId);
    if (currentIndex === -1) {
      // Fallback: match by name
      const targetName = targetMeta?.name?.toLowerCase().trim() || '';
      if (targetName) currentIndex = storeys.findIndex(s => s.name.toLowerCase().trim() === targetName);
    }
    if (currentIndex === -1) return null;

    const currentFloor = storeys[currentIndex];
    if (currentIndex < storeys.length - 1) {
      const nextFloor = storeys[currentIndex + 1];

      // Try to find the bottom of slab entities on the next storey
      const slabBottomY = findSlabBottomY(nextFloor.id);
      if (slabBottomY !== null) {
        const clipHeight = slabBottomY - 0.02;
        logger.log(`[SectionPlane] Clip at next-floor slab bottom: ${slabBottomY.toFixed(3)} → clipHeight=${clipHeight.toFixed(3)} (floor: ${nextFloor.name})`);
        return { clipHeight, nextFloorMinY: slabBottomY };
      }

      // Fallback: use next floor overall minY
      const clipHeight = nextFloor.minY + 0.05;
      logger.log(`[SectionPlane] No slabs found on next floor "${nextFloor.name}", falling back to minY=${nextFloor.minY.toFixed(3)}`);
      return { clipHeight, nextFloorMinY: nextFloor.minY };
    } else {
      return { clipHeight: currentFloor.maxY + 0.1, nextFloorMinY: null };
    }
  }, [getXeokitViewer, calculateFloorBounds, findSlabBottomY]);

  /**
   * Apply 3D ceiling clipping (solo floor mode)
   */
  const applyCeilingClipping = useCallback((floorId: string) => {
    if (!enabled) return;
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;

    ensureAllEntitiesClippable();
    destroyPlane(topPlaneRef);
    destroyPlane(bottomPlaneRef);
    
    const result = calculateClipHeightFromFloorBoundary(floorId);
    if (!result) return;
    
    const { clipHeight: baseClipHeight, nextFloorMinY } = result;
    nextFloorMinYRef.current = nextFloorMinY;

    const bounds = calculateFloorBounds(floorId);
    if (bounds) currentFloorMinYRef.current = bounds.minY;

    destroyPlane(ceilingPlaneRef);

    const adjustedClipHeight = baseClipHeight + ceiling3DOffsetRef.current;

    ceilingPlaneRef.current = createSectionPlane(
      `3d-ceiling-${floorId}`,
      [0, adjustedClipHeight, 0],
      [0, 1, 0]
    );

    if (ceilingPlaneRef.current) {
      logger.log(`✅ 3D Ceiling clipping at Y=${adjustedClipHeight.toFixed(2)} for ${bounds?.name || floorId}`);
      currentFloorIdRef.current = floorId;
      currentClipModeRef.current = 'ceiling';
    }
  }, [enabled, getXeokitViewer, calculateFloorBounds, calculateClipHeightFromFloorBoundary, createSectionPlane, destroyPlane, ensureAllEntitiesClippable]);

  /**
   * Apply 2D floor plan clipping — TOP plane only (no bottom plane).
   * The bottom plane was clipping away the floor slab and everything below,
   * resulting in an empty view. In 2D plan mode we only need a ceiling cut
   * at floorCutHeight (default 0.5m) above the floor level.
   */
  const applyFloorPlanClipping = useCallback((floorId: string, customHeight?: number) => {
    if (!enabled) return;
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;

    ensureAllEntitiesClippable();
    destroyPlane(ceilingPlaneRef);

    const bounds = calculateFloorBounds(floorId);
    if (!bounds) return;

    const floorCutHeight = customHeight ?? floorCutHeightRef.current;
    if (customHeight !== undefined) floorCutHeightRef.current = customHeight;

    currentFloorMinYRef.current = bounds.minY;
    // Expose bounds globally so the 2D visual handler can use them for slab filtering
    (window as any).__2d_currentFloorBounds = { minY: bounds.minY, maxY: bounds.maxY };

    const topClipY = bounds.minY + floorCutHeight;

    destroyPlane(topPlaneRef);
    destroyPlane(bottomPlaneRef); // ensure no stale bottom plane

    topPlaneRef.current = createSectionPlane(
      `2d-top-${floorId}`,
      [0, topClipY, 0],
      [0, 1, 0]
    );

    if (topPlaneRef.current) {
      logger.log(`✅ 2D Top-only clip at Y=${topClipY.toFixed(2)} (floor=${bounds.minY.toFixed(2)} + ${floorCutHeight}m) for ${bounds.name}`);
      currentFloorIdRef.current = floorId;
      currentClipModeRef.current = 'floor';
    } else {
      logger.warn(`❌ 2D clipping failed for ${bounds.name} — no section plane created`);
    }
  }, [enabled, getXeokitViewer, calculateFloorBounds, createSectionPlane, destroyPlane, ensureAllEntitiesClippable]);

  const applyGlobalFloorPlanClipping = useCallback((baseHeight: number) => {
    if (!enabled) return;
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;

    ensureAllEntitiesClippable();
    destroyPlane(ceilingPlaneRef);
    
    const topClipY = baseHeight + floorCutHeightRef.current;
    currentFloorMinYRef.current = baseHeight;

    destroyPlane(topPlaneRef);
    destroyPlane(bottomPlaneRef); // no bottom plane in 2D

    topPlaneRef.current = createSectionPlane('2d-global-top', [0, topClipY, 0], [0, 1, 0]);

    if (topPlaneRef.current) {
      logger.log(`✅ Global 2D clipping: top=${topClipY.toFixed(2)} (no bottom plane)`);
      currentFloorIdRef.current = null;
      currentClipModeRef.current = 'floor';
    }
  }, [enabled, getXeokitViewer, createSectionPlane, destroyPlane, ensureAllEntitiesClippable]);

  const update3DCeilingOffset = useCallback((newOffset: number) => {
    ceiling3DOffsetRef.current = newOffset;
    const viewer = getXeokitViewer();
    if (!viewer?.scene || currentClipModeRef.current !== 'ceiling') return;
    
    const baseHeight = nextFloorMinYRef.current ?? (currentFloorMinYRef.current + 3.0);
    const newClipY = baseHeight + newOffset;
    
    if (ceilingPlaneRef.current) {
      try {
        ceilingPlaneRef.current.pos = [0, newClipY, 0];
        logger.log(`✅ 3D ceiling offset updated to Y=${newClipY.toFixed(2)}`);
        return;
      } catch (e) { /* recreate below */ }
    }
    
    destroyPlane(ceilingPlaneRef);
    ceilingPlaneRef.current = createSectionPlane('3d-ceiling-stable', [0, newClipY, 0], [0, 1, 0]);
  }, [getXeokitViewer, createSectionPlane, destroyPlane]);

  const updateFloorCutHeight = useCallback((newHeight: number) => {
    floorCutHeightRef.current = newHeight;
    const viewer = getXeokitViewer();
    if (!viewer?.scene || currentClipModeRef.current !== 'floor') return;

    const topClipY = currentFloorMinYRef.current + newHeight;

    if (topPlaneRef.current) {
      try {
        topPlaneRef.current.pos = [0, topClipY, 0];
        logger.log(`✅ 2D top plane updated to Y=${topClipY.toFixed(2)}`);
        return;
      } catch (e) { /* recreate below */ }
    }

    destroyPlane(topPlaneRef);
    topPlaneRef.current = createSectionPlane('2d-top-stable', [0, topClipY, 0], [0, 1, 0]);
    // Bottom plane stays fixed at floor.minY - 0.05; no need to update it
  }, [getXeokitViewer, createSectionPlane, destroyPlane]);

  const removeSectionPlane = useCallback(() => {
    removeAllClippingPlanes();
    currentFloorIdRef.current = null;
    currentClipModeRef.current = null;
  }, [removeAllClippingPlanes]);

  const remove2DClipping = useCallback(() => {
    destroyPlane(topPlaneRef);
    destroyPlane(bottomPlaneRef);
    if (currentClipModeRef.current === 'floor') currentClipModeRef.current = null;
  }, [destroyPlane]);

  const remove3DClipping = useCallback(() => {
    destroyPlane(ceilingPlaneRef);
    if (currentClipModeRef.current === 'ceiling') currentClipModeRef.current = null;
  }, [destroyPlane]);

  const applySectionPlane = useCallback((floorId: string, mode?: ClipMode) => {
    const effectiveMode = mode || clipMode;
    if (effectiveMode === 'ceiling') applyCeilingClipping(floorId);
    else applyFloorPlanClipping(floorId);
  }, [clipMode, applyCeilingClipping, applyFloorPlanClipping]);

  const updateClipping = useCallback((visibleFloorIds: string[]) => {
    if (visibleFloorIds.length === 1) {
      const floorId = visibleFloorIds[0];
      if (floorId !== currentFloorIdRef.current || currentClipModeRef.current !== 'ceiling') {
        applyCeilingClipping(floorId);
      }
    } else {
      if (currentClipModeRef.current === 'ceiling') remove3DClipping();
    }
  }, [applyCeilingClipping, remove3DClipping]);

  const getCurrentFloorBounds = useCallback(() => {
    if (!currentFloorIdRef.current) return null;
    return calculateFloorBounds(currentFloorIdRef.current);
  }, [calculateFloorBounds]);

  useEffect(() => {
    return () => { removeAllClippingPlanes(); };
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
