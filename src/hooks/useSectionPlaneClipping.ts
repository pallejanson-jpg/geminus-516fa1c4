import { useRef, useCallback, useEffect } from 'react';

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
 * Diagnose what the AssetPlusViewer UMD bundle exposes on the xeokit scene.
 * Call this after viewer init to understand available APIs.
 */
export function diagnoseXeokitScene(viewer: any) {
  if (!viewer?.scene) {
    console.warn('[SectionPlane Diag] No scene available');
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
  console.log('[SectionPlane Diag] Scene component types:', [...typeSet]);
  console.log('[SectionPlane Diag] scene.sectionPlanes:', Object.keys(scene.sectionPlanes || {}));
  console.log('[SectionPlane Diag] scene._sectionPlanesState:', !!scene._sectionPlanesState);
  
  // Check for SectionPlane class on scene prototype chain
  console.log('[SectionPlane Diag] scene.SectionPlane:', !!scene.SectionPlane);
  
  // Check viewer plugins
  const plugins = viewer.plugins || {};
  console.log('[SectionPlane Diag] Viewer plugins:', Object.keys(plugins));
  
  // Try to find SectionPlane constructor from existing components
  const spClass = extractSectionPlaneClass(viewer);
  console.log('[SectionPlane Diag] Extracted SectionPlane class:', !!spClass, spClass?.name || 'unknown');
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
    console.log('[SectionPlane] Found class globally');
    return globalClass;
  }

  // Strategy 2: Find existing SectionPlane instance and grab its constructor
  const existingPlanes = scene.sectionPlanes || {};
  for (const plane of Object.values(existingPlanes)) {
    if ((plane as any)?.constructor) {
      cachedSectionPlaneClass = (plane as any).constructor;
      console.log('[SectionPlane] Extracted class from existing plane');
      return cachedSectionPlaneClass;
    }
  }

  // Strategy 3: Search all components for type === "SectionPlane"
  const components = scene.components || {};
  for (const comp of Object.values(components)) {
    if ((comp as any)?.type === 'SectionPlane' && (comp as any)?.constructor) {
      cachedSectionPlaneClass = (comp as any).constructor;
      console.log('[SectionPlane] Extracted class from component registry');
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
          console.log('[SectionPlane] Extracted class from plugin');
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
  const { enabled = true, offset: initialOffset = 0.05, clipMode = 'ceiling', floorCutHeight: initialFloorCutHeight = 0.5 } = options;
  
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
    if (!viewer?.scene?.objects) return;
    
    let count = 0;
    Object.values(viewer.scene.objects).forEach((entity: any) => {
      if (entity && entity.clippable === false) {
        entity.clippable = true;
        count++;
      }
    });
    
    if (count > 0) {
      console.log(`[SectionPlane] Enabled clippable on ${count} entities`);
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
      console.warn('[SectionPlane] No viewer/scene available');
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
        console.log(`✅ SectionPlane via scene.createSectionPlane: ${id} at Y=${pos[1].toFixed(2)}, dir=[${dir}]`);
        return plane;
      } catch (e) {
        console.warn('[SectionPlane] scene.createSectionPlane failed:', e);
      }
    }

    // Method 1: Use extracted SectionPlane constructor
    const SectionPlaneClass = extractSectionPlaneClass(viewer);
    if (SectionPlaneClass) {
      try {
        const plane = new SectionPlaneClass(scene, { id, pos, dir, active: true });
        console.log(`✅ SectionPlane created via constructor: ${id} at Y=${pos[1].toFixed(2)}, dir=[${dir}]`);
        return plane;
      } catch (e) {
        console.warn('[SectionPlane] Constructor creation failed:', e);
      }
    }

    // Method 2: Check for SectionPlanesPlugin on viewer
    const plugins = viewer.plugins || {};
    for (const plugin of Object.values(plugins)) {
      if (typeof (plugin as any)?.createSectionPlane === 'function') {
        try {
          const plane = (plugin as any).createSectionPlane({ id, pos, dir, active: true });
          console.log(`✅ SectionPlane created via plugin: ${id} at Y=${pos[1].toFixed(2)}, dir=[${dir}]`);
          return plane;
        } catch (e) {
          console.warn('[SectionPlane] Plugin creation failed:', e);
        }
      }
    }

    // Method 3: Try global SectionPlanesPlugin class
    const SPPlugin = (window as any).xeokit?.SectionPlanesPlugin || (window as any).SectionPlanesPlugin;
    if (SPPlugin) {
      try {
        const tempPlugin = new SPPlugin(viewer, { id: 'lovable-sp-plugin' });
        const plane = tempPlugin.createSectionPlane({ id, pos, dir, active: true });
        console.log(`✅ SectionPlane created via new SectionPlanesPlugin: ${id} at Y=${pos[1].toFixed(2)}`);
        return plane;
      } catch (e) {
        console.warn('[SectionPlane] Global SectionPlanesPlugin failed:', e);
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
        console.log(`✅ SectionPlane via _sectionPlanesState: ${id} at Y=${pos[1].toFixed(2)}`);
        return plane;
      } catch (e) {
        console.warn('[SectionPlane] _sectionPlanesState failed:', e);
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

    if (!hasValidBounds) return null;

    return { id: floorId, name: floorMeta.name || 'Floor', minY, maxY, metaObjectIds: childIds };
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
        console.log(`[SectionPlane] Clip at next-floor slab bottom: ${slabBottomY.toFixed(3)} → clipHeight=${clipHeight.toFixed(3)} (floor: ${nextFloor.name})`);
        return { clipHeight, nextFloorMinY: slabBottomY };
      }

      // Fallback: use next floor overall minY
      const clipHeight = nextFloor.minY + 0.05;
      console.log(`[SectionPlane] No slabs found on next floor "${nextFloor.name}", falling back to minY=${nextFloor.minY.toFixed(3)}`);
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
      console.log(`✅ 3D Ceiling clipping at Y=${adjustedClipHeight.toFixed(2)} for ${bounds?.name || floorId}`);
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

    const topClipY = bounds.minY + floorCutHeight;

    destroyPlane(topPlaneRef);
    destroyPlane(bottomPlaneRef); // ensure no stale bottom plane

    topPlaneRef.current = createSectionPlane(
      `2d-top-${floorId}`,
      [0, topClipY, 0],
      [0, 1, 0]
    );

    if (topPlaneRef.current) {
      console.log(`✅ 2D Top-only clip at Y=${topClipY.toFixed(2)} (floor=${bounds.minY.toFixed(2)} + ${floorCutHeight}m) for ${bounds.name}`);
      currentFloorIdRef.current = floorId;
      currentClipModeRef.current = 'floor';
    } else {
      console.warn(`❌ 2D clipping failed for ${bounds.name} — no section plane created`);
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
      console.log(`✅ Global 2D clipping: top=${topClipY.toFixed(2)} (no bottom plane)`);
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
        console.log(`✅ 3D ceiling offset updated to Y=${newClipY.toFixed(2)}`);
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
        console.log(`✅ 2D top plane updated to Y=${topClipY.toFixed(2)}`);
        return;
      } catch (e) { /* recreate below */ }
    }
    
    destroyPlane(topPlaneRef);
    topPlaneRef.current = createSectionPlane('2d-top-stable', [0, topClipY, 0], [0, 1, 0]);
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
