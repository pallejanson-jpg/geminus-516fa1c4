/**
 * Shared room-centroid math for the xeokit scene, used both for room labels
 * (useRoomLabels.ts) and for auto-placing 360° POIs at a room's center
 * (UnplacedAssetsPanel.tsx).
 */
import { normalizeGuid } from '@/lib/utils';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Find the IfcSpace metaObject for a room by its FM GUID.
 * Same lookup idiom as useObjectMoveMode.ts's detectRoomAtPosition.
 */
export function findRoomMetaObject(viewer: any, roomFmGuid: string | null | undefined): any | null {
  const metaObjects = viewer?.metaScene?.metaObjects;
  if (!metaObjects || !roomFmGuid) return null;

  const target = normalizeGuid(roomFmGuid);
  for (const mo of Object.values(metaObjects) as any[]) {
    if ((mo.type || '').toLowerCase() !== 'ifcspace') continue;
    if (normalizeGuid(mo.originalSystemId || mo.id) === target) {
      return mo;
    }
  }
  return null;
}

/**
 * Build a parent metaObject id -> child metaObject ids map, once, so that
 * computing centroids for many rooms doesn't re-scan all metaObjects per room.
 */
export function buildRoomChildrenMap(metaObjects: Record<string, any>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  Object.values(metaObjects).forEach((mo: any) => {
    const parentId = mo.parent?.id;
    if (!parentId) return;
    if (!map.has(parentId)) map.set(parentId, []);
    map.get(parentId)!.push(mo.id);
  });
  return map;
}

/**
 * Compute a room's centroid in BIM-local coordinates as a weighted average
 * of its child entities' AABB centers — more accurate than the room's own
 * bounding-box center for L/T-shaped rooms, where the box center can land
 * outside the actual room. Falls back to the room's own AABB center when it
 * has no child geometry.
 *
 * If `childrenMap` is omitted, children are found with a one-off scan of
 * `viewer.metaScene.metaObjects` — fine for a handful of lookups, but pass a
 * map built once via `buildRoomChildrenMap` when computing many centroids.
 */
export function computeRoomCentroid(
  viewer: any,
  roomMetaObject: any,
  childrenMap?: Map<string, string[]>
): Point3 | null {
  const scene = viewer?.scene;
  if (!scene?.objects || !roomMetaObject) return null;

  const entity = scene.objects[roomMetaObject.id];
  if (!entity?.aabb) return null;

  const aabb = entity.aabb;
  let centerX = (aabb[0] + aabb[3]) / 2;
  let centerZ = (aabb[2] + aabb[5]) / 2;
  const centerY = aabb[1];

  const childIds =
    childrenMap?.get(roomMetaObject.id) ??
    (viewer.metaScene?.metaObjects
      ? buildRoomChildrenMap(viewer.metaScene.metaObjects).get(roomMetaObject.id)
      : undefined);

  if (childIds && childIds.length > 0) {
    let sumX = 0, sumZ = 0, count = 0;
    childIds.forEach((childId) => {
      const childEntity = scene.objects?.[childId];
      if (childEntity?.aabb) {
        const ca = childEntity.aabb;
        sumX += (ca[0] + ca[3]) / 2;
        sumZ += (ca[2] + ca[5]) / 2;
        count++;
      }
    });
    if (count > 0) {
      centerX = sumX / count;
      centerZ = sumZ / count;
    }
  }

  return { x: centerX, y: centerY, z: centerZ };
}
