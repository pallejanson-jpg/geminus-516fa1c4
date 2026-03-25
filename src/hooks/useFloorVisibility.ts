import { useCallback, useState, useRef } from 'react';
import { FloorInfo } from '@/hooks/useFloorData';

// ── Shared xeokit viewer accessor ─────────────────────────────────────────
export function getXeokitViewerFromRef(viewerRef: React.MutableRefObject<any>) {
  try {
    return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  } catch {
    return null;
  }
}

// ── Recursive descendant collector ────────────────────────────────────────
export function getDescendantIds(viewer: any, rootId: string): string[] {
  const metaObj = viewer?.metaScene?.metaObjects?.[rootId];
  if (!metaObj) return [rootId];
  const ids: string[] = [rootId];
  const collect = (obj: any) => {
    obj.children?.forEach((child: any) => {
      ids.push(child.id);
      collect(child);
    });
  };
  collect(metaObj);
  return ids;
}

// ── Floor bounds calculator ───────────────────────────────────────────────
export function calculateFloorBounds(viewer: any, floorId: string): { minY: number; maxY: number } | null {
  if (!viewer?.metaScene?.metaObjects || !viewer?.scene?.objects) return null;
  const floorMeta = viewer.metaScene.metaObjects[floorId];
  if (!floorMeta) return null;

  const childIds = getDescendantIds(viewer, floorId);
  let minY = Infinity, maxY = -Infinity;
  childIds.forEach(id => {
    const entity = viewer.scene.objects[id];
    if (entity?.aabb) {
      if (entity.aabb[1] < minY) minY = entity.aabb[1];
      if (entity.aabb[4] > maxY) maxY = entity.aabb[4];
    }
  });
  return minY === Infinity ? null : { minY, maxY };
}

// ── Children map builder (for efficient batch operations) ─────────────────
function buildChildrenMapFromViewer(viewer: any): Map<string, string[]> {
  const metaObjects = viewer?.metaScene?.metaObjects;
  if (!metaObjects) return new Map();
  const map = new Map<string, string[]>();
  Object.values(metaObjects).forEach((mo: any) => {
    const parentId = mo.parent?.id;
    if (parentId) {
      if (!map.has(parentId)) map.set(parentId, []);
      map.get(parentId)!.push(mo.id);
    }
  });
  return map;
}

function getChildIdsFromMap(id: string, childrenMap: Map<string, string[]>): string[] {
  const ids: string[] = [id];
  (childrenMap.get(id) || []).forEach(childId => {
    ids.push(...getChildIdsFromMap(childId, childrenMap));
  });
  return ids;
}

// ── Hide IfcSpace / "Area" objects ────────────────────────────────────────
export function hideSpaceAndAreaObjects(viewer: any, scopeIds?: Set<string>) {
  const metaObjects = viewer?.metaScene?.metaObjects;
  const scene = viewer?.scene;
  if (!metaObjects || !scene) return;

  Object.entries(metaObjects).forEach(([id, mo]: [string, any]) => {
    if (scopeIds && !scopeIds.has(id)) return;
    const ifcType = (mo.type || '').toLowerCase();
    const objName = (mo.name || '').toLowerCase();
    const isSpace = ifcType.includes('ifcspace') || ifcType === 'ifc_space' || ifcType === 'space';
    const isArea = objName === 'area' || objName === 'areas';
    if (isSpace || isArea) {
      const entity = scene.objects?.[id];
      if (entity) {
        entity.visible = false;
        entity.pickable = false;
      }
    }
  });
}

// ── Hide IfcCovering in solo mode ─────────────────────────────────────────
export function hideCoveringObjects(viewer: any) {
  const metaObjects = viewer?.metaScene?.metaObjects;
  const scene = viewer?.scene;
  if (!metaObjects || !scene) return;

  Object.values(metaObjects).forEach((mo: any) => {
    if (mo.type?.toLowerCase() === 'ifccovering') {
      const entity = scene.objects?.[mo.id];
      if (entity) entity.visible = false;
    }
  });
}

// ── Apply floor visibility (the main shared logic) ────────────────────────
export function applyFloorVisibilityToScene(
  viewer: any,
  floors: FloorInfo[],
  visibleIds: Set<string>,
  childrenMap: Map<string, string[]>,
): string[] {
  const scene = viewer?.scene;
  if (!scene) return [];

  const isSoloMode = visibleIds.size === 1;
  const idsToShow: string[] = [];
  floors.forEach(floor => {
    if (visibleIds.has(floor.id)) {
      floor.metaObjectIds.forEach(metaObjId => {
        idsToShow.push(...getChildIdsFromMap(metaObjId, childrenMap));
      });
    }
  });

  if (idsToShow.length === 0) return [];

  // Clear selection state to prevent red-highlight persistence across floor switches
  const selected = scene.selectedObjectIds;
  if (selected?.length) scene.setObjectsSelected(selected, false);

  if (scene.setObjectsVisible && scene.objectIds) {
    scene.setObjectsVisible(scene.objectIds, false);
    scene.setObjectsVisible(idsToShow, true);
  } else {
    const set = new Set(idsToShow);
    Object.entries(scene.objects || {}).forEach(([id, entity]: [string, any]) => {
      if (entity && typeof entity.visible !== 'undefined') entity.visible = set.has(id);
    });
  }

  // Re-hide spaces/area objects
  hideSpaceAndAreaObjects(viewer, new Set(idsToShow));

  // Hide coverings in solo mode
  if (isSoloMode) hideCoveringObjects(viewer);

  return idsToShow;
}

// ── React hook wrapping the shared utilities ──────────────────────────────
export function useFloorVisibility(viewerRef: React.MutableRefObject<any>) {
  const [childrenMapCache, setChildrenMapCache] = useState<Map<string, string[]> | null>(null);

  const getViewer = useCallback(() => {
    return getXeokitViewerFromRef(viewerRef);
  }, [viewerRef]);

  const buildChildrenMap = useCallback(() => {
    if (childrenMapCache) return childrenMapCache;
    const viewer = getViewer();
    const map = buildChildrenMapFromViewer(viewer);
    if (map.size > 0) setChildrenMapCache(map);
    return map;
  }, [getViewer, childrenMapCache]);

  const calcFloorBounds = useCallback((floorId: string) => {
    return calculateFloorBounds(getViewer(), floorId);
  }, [getViewer]);

  const applyVisibility = useCallback((floors: FloorInfo[], visibleIds: Set<string>) => {
    const viewer = getViewer();
    if (!viewer?.scene) return;
    const childrenMap = buildChildrenMap();
    applyFloorVisibilityToScene(viewer, floors, visibleIds, childrenMap);
  }, [getViewer, buildChildrenMap]);

  return {
    getViewer,
    buildChildrenMap,
    calculateFloorBounds: calcFloorBounds,
    applyFloorVisibility: applyVisibility,
  };
}
