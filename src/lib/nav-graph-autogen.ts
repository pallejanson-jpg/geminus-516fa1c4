/**
 * Auto-generates a navigation-graph SUGGESTION for one floor from the already-loaded
 * BIM model, instead of requiring every node/edge to be hand-drawn in
 * NavGraphEditorOverlay. Reads live xeokit scene geometry (room/door/stair/elevator
 * AABBs) — the model itself is the source of truth, so this works even where DB
 * coordinate_x/y/z columns are unpopulated (see indoor-route-3d.ts for the same
 * reasoning).
 *
 * This never writes to the database — it returns a plain NavGraph that the existing
 * editor renders for the user to review, adjust, and save exactly like a hand-drawn
 * graph. Heuristics (door-to-room proximity, cross-floor footprint matching) are
 * deliberately simple: the goal is a reasonable starting point, not a perfect graph.
 */

import { getDescendantIds } from '@/hooks/useFloorVisibility';
import type { FloorInfo } from '@/hooks/useFloorData';
import type { NavGraph, NavNode, NavEdge } from '@/lib/pathfinding';
import { getFloorAabb, resolveFloorMetaObjectIds, type Aabb6 } from '@/lib/indoor-route-3d';

const SPACE_TYPES = new Set(['ifcspace']);
const DOOR_TYPES = new Set(['ifcdoor', 'ifcdoorstandardcase']);
const STAIR_TYPES = new Set(['ifcstair', 'ifcstairflight']);
const ELEVATOR_TYPES = new Set(['ifctransportelement']);

/** Meters within which a door/stair is considered "touching" a room for connection purposes. */
const TOUCH_MARGIN = 1.5;
/** Meters within which two vertical-circulation objects on different floors are treated as the same physical stairwell/elevator. */
const VERTICAL_MATCH_RADIUS = 3;
/** Meters beyond which a stair/elevator node won't bother connecting to its nearest room (likely no real room found on this floor). */
const MAX_VERTICAL_TO_ROOM_DISTANCE = 30;

function normalizeGuid(v?: string | null): string {
  return (v || '').toLowerCase().replace(/-/g, '');
}

function aabbCenter(aabb: number[]): [number, number, number] {
  return [(aabb[0] + aabb[3]) / 2, (aabb[1] + aabb[4]) / 2, (aabb[2] + aabb[5]) / 2];
}

function dist3(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function distXZ(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

/** A room's AABB "contains" a point when the point is within TOUCH_MARGIN of its horizontal footprint (ignores Y — doors/rooms share a floor level). */
function roomTouchesPoint(roomAabb: number[], pt: [number, number, number], margin = TOUCH_MARGIN): boolean {
  return pt[0] >= roomAabb[0] - margin && pt[0] <= roomAabb[3] + margin
    && pt[2] >= roomAabb[2] - margin && pt[2] <= roomAabb[5] + margin;
}

function worldToFloorPct(pos: [number, number, number], floorAabb: Aabb6): [number, number] {
  const [xmin, , zmin, xmax, , zmax] = floorAabb;
  const xPct = xmax > xmin ? ((pos[0] - xmin) / (xmax - xmin)) * 100 : 50;
  const zPct = zmax > zmin ? ((pos[2] - zmin) / (zmax - zmin)) * 100 : 50;
  return [xPct, zPct];
}

let idCounter = 0;
function makeNodeId(prefix: string): string {
  idCounter += 1;
  return `auto_${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

export interface VerticalNode {
  nodeId: string;
  type: 'stairwell' | 'elevator';
  worldPos: [number, number, number];
  floorFmGuid: string | null;
}

/** Find every already-present stairwell/elevator node in a graph, with its BIM world position resolved (needed to cross-link a newly generated floor to floors generated earlier). */
export function collectVerticalNodes(viewer: any, floors: FloorInfo[], graph: NavGraph): VerticalNode[] {
  const result: VerticalNode[] = [];
  for (const node of graph.nodes.values()) {
    if (node.type !== 'stairwell' && node.type !== 'elevator') continue;
    const floor = floors.find(f => f.databaseLevelFmGuids.some(g => normalizeGuid(g) === normalizeGuid(node.floor_fm_guid)));
    const aabb = getFloorAabb(viewer, floor || null);
    if (!aabb) continue;
    const [xmin, ymin, zmin, xmax, , zmax] = aabb;
    const worldPos: [number, number, number] = [
      xmin + (node.coordinates[0] / 100) * (xmax - xmin),
      ymin,
      zmin + (node.coordinates[1] / 100) * (zmax - zmin),
    ];
    result.push({ nodeId: node.nodeId, type: node.type, worldPos, floorFmGuid: node.floor_fm_guid ?? null });
  }
  return result;
}

interface GenerateOptions {
  /** Maps a normalized (lowercase, no dashes) metaObject.originalSystemId to the canonical assets.fm_guid, for linking auto-generated room nodes to their Space asset. */
  roomFmGuidByOriginalId: Map<string, string>;
  /** Vertical (stairwell/elevator) nodes already known from other floors already present in the working graph, so this floor's stairs/elevators link up with them. */
  existingVerticalNodes: VerticalNode[];
}

/**
 * Generate a suggested graph for a single floor: room-centroid nodes, door-based
 * connections between them, and stairwell/elevator nodes wired both to the nearest
 * room and (when a footprint match is found) to matching vertical nodes on other
 * floors already in the working graph.
 */
export function generateFloorNavGraph(viewer: any, floor: FloorInfo, options: GenerateOptions): NavGraph {
  const nodes = new Map<string, NavNode>();
  const edges: NavEdge[] = [];
  const floorFmGuid = floor.databaseLevelFmGuids[0] || null;

  if (!viewer?.scene || !viewer?.metaScene?.metaObjects) return { nodes, edges };

  const floorAabb = getFloorAabb(viewer, floor);
  if (!floorAabb) return { nodes, edges };

  const metaObjects = viewer.metaScene.metaObjects;
  const floorIds = new Set<string>();
  resolveFloorMetaObjectIds(viewer, floor).forEach(id => getDescendantIds(viewer, id).forEach(cid => floorIds.add(cid)));

  const rooms: Array<{ nodeId: string; aabb: number[]; center: [number, number, number] }> = [];

  // 1. Rooms → centroid nodes
  for (const id of floorIds) {
    const mo = metaObjects[id];
    const ifcType = (mo?.type || '').toLowerCase();
    if (!SPACE_TYPES.has(ifcType)) continue;
    const entity = viewer.scene.objects?.[id];
    if (!entity?.aabb) continue;

    const center = aabbCenter(entity.aabb);
    const nodeId = makeNodeId('room');
    const originalNorm = normalizeGuid(mo.originalSystemId || mo.id);
    const roomFmGuid = options.roomFmGuidByOriginalId.get(originalNorm) || null;

    nodes.set(nodeId, {
      nodeId,
      coordinates: worldToFloorPct(center, floorAabb),
      room_fm_guid: roomFmGuid,
      floor_fm_guid: floorFmGuid,
      type: 'waypoint',
    });
    rooms.push({ nodeId, aabb: entity.aabb, center });
  }

  // 2. Doors → connect the room(s) whose footprint the door sits on the edge of
  for (const id of floorIds) {
    const mo = metaObjects[id];
    const ifcType = (mo?.type || '').toLowerCase();
    if (!DOOR_TYPES.has(ifcType)) continue;
    const entity = viewer.scene.objects?.[id];
    if (!entity?.aabb) continue;

    const center = aabbCenter(entity.aabb);
    const touchingRooms = rooms.filter(r => roomTouchesPoint(r.aabb, center));
    if (touchingRooms.length === 0) continue;

    const doorNodeId = makeNodeId('door');
    nodes.set(doorNodeId, {
      nodeId: doorNodeId,
      coordinates: worldToFloorPct(center, floorAabb),
      room_fm_guid: null,
      floor_fm_guid: floorFmGuid,
      type: 'waypoint',
    });

    touchingRooms.slice(0, 2).forEach(room => {
      edges.push({ from: doorNodeId, to: room.nodeId, weight: dist3(center, room.center) });
    });
  }

  // 3. Stairs/elevators → nodes, wired to the nearest room and to matching vertical nodes on other floors
  for (const id of floorIds) {
    const mo = metaObjects[id];
    const ifcType = (mo?.type || '').toLowerCase();
    const isStair = STAIR_TYPES.has(ifcType);
    const isElevator = ELEVATOR_TYPES.has(ifcType);
    if (!isStair && !isElevator) continue;
    const entity = viewer.scene.objects?.[id];
    if (!entity?.aabb) continue;

    const center = aabbCenter(entity.aabb);
    const nodeType: NavNode['type'] = isStair ? 'stairwell' : 'elevator';
    const nodeId = makeNodeId(isStair ? 'stair' : 'elevator');
    nodes.set(nodeId, {
      nodeId,
      coordinates: worldToFloorPct(center, floorAabb),
      room_fm_guid: null,
      floor_fm_guid: floorFmGuid,
      type: nodeType,
    });

    let nearestRoom: { nodeId: string; dist: number } | null = null;
    for (const room of rooms) {
      const d = dist3(center, room.center);
      if (!nearestRoom || d < nearestRoom.dist) nearestRoom = { nodeId: room.nodeId, dist: d };
    }
    if (nearestRoom && nearestRoom.dist < MAX_VERTICAL_TO_ROOM_DISTANCE) {
      edges.push({ from: nodeId, to: nearestRoom.nodeId, weight: nearestRoom.dist });
    }

    // Cross-floor link: same type, close horizontal footprint, different floor
    const match = options.existingVerticalNodes.find(v =>
      v.type === nodeType
      && normalizeGuid(v.floorFmGuid) !== normalizeGuid(floorFmGuid)
      && distXZ(center, v.worldPos) < VERTICAL_MATCH_RADIUS
    );
    if (match) {
      edges.push({ from: nodeId, to: match.nodeId, weight: 1 });
    }
  }

  return { nodes, edges };
}

/**
 * Merge a freshly generated floor graph into a working graph, replacing whatever
 * that floor previously contributed (so re-running the suggestion on a floor is
 * idempotent) while preserving every other floor untouched.
 */
export function mergeGeneratedFloor(existingGraph: NavGraph, floorFmGuid: string | null, generated: NavGraph): NavGraph {
  const floorNorm = normalizeGuid(floorFmGuid);
  const nodes = new Map<string, NavNode>();
  for (const [id, node] of existingGraph.nodes) {
    if (normalizeGuid(node.floor_fm_guid) === floorNorm) continue;
    nodes.set(id, node);
  }
  for (const [id, node] of generated.nodes) nodes.set(id, node);

  // Any edge touching a node from the replaced floor is dropped automatically here,
  // since that node id no longer exists in `nodes` — generated.edges replaces it.
  // (Regenerating an earlier floor after a later floor already linked to it will
  // orphan that one cross-floor link; re-running the later floor's generation
  // re-establishes it. Not auto-healed both ways — acceptable for a suggestion tool.)
  const keptIds = new Set(nodes.keys());
  const edges = existingGraph.edges.filter(e => keptIds.has(e.from) && keptIds.has(e.to));
  edges.push(...generated.edges);

  return { nodes, edges };
}
