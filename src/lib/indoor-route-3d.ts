/**
 * Converts a Dijkstra RouteResult (nav-graph %-coordinates, see pathfinding.ts) into
 * xeokit world-space geometry for rendering inside the 3D BIM viewer.
 *
 * Unlike the outdoor-map projection in indoor-route-geometry.ts (which denormalizes
 * % -> BIM meters using room asset coordinate_x/coordinate_z from the database),
 * this reads the floor's real bounding box directly from the loaded xeokit scene
 * via FloorInfo.metaObjectIds. That's more robust here: the DB coordinate columns
 * are frequently unpopulated, but the 3D model itself is always the source of truth
 * for where a floor actually is once it's loaded.
 */

import { getDescendantIds } from '@/hooks/useFloorVisibility';
import type { FloorInfo } from '@/hooks/useFloorData';
import type { RouteResult, NavNode, IndoorStep } from '@/lib/pathfinding';

/** [xmin, ymin, zmin, xmax, ymax, zmax] */
export type Aabb6 = [number, number, number, number, number, number];

/** Height above a floor's lowest surface to float the route line/markers, so they clear furniture. */
const ROUTE_HEIGHT_OFFSET = 0.3;

function normalizeGuid(v?: string | null): string {
  return (v || '').toLowerCase().replace(/-/g, '');
}

/** Find the FloorInfo whose databaseLevelFmGuids contains the given floor_fm_guid. */
export function findFloorForGuid(floors: FloorInfo[], floorFmGuid: string | null | undefined): FloorInfo | null {
  if (!floorFmGuid) return null;
  const norm = normalizeGuid(floorFmGuid);
  return floors.find(f => f.databaseLevelFmGuids.some(g => normalizeGuid(g) === norm)) || null;
}

/** Combined AABB of everything under a floor, read live from the xeokit scene. Falls back to the whole model's AABB. */
export function getFloorAabb(viewer: any, floor: FloorInfo | null): Aabb6 | null {
  if (!viewer?.scene) return null;
  const wholeScene = (): Aabb6 | null => (viewer.scene.aabb ? (Array.from(viewer.scene.aabb) as Aabb6) : null);
  if (!floor || floor.metaObjectIds.length === 0) return wholeScene();

  const ids = new Set<string>();
  floor.metaObjectIds.forEach(id => getDescendantIds(viewer, id).forEach(cid => ids.add(cid)));
  if (ids.size === 0) return wholeScene();

  const aabb = viewer.scene.getAABB(Array.from(ids));
  return aabb ? (Array.from(aabb) as Aabb6) : wholeScene();
}

/** Denormalize a nav-graph [x%, z%] coordinate into BIM world-space meters using a floor's AABB. */
export function pctToWorld(xPct: number, zPct: number, aabb: Aabb6, yOverride?: number): [number, number, number] {
  const [xmin, ymin, zmin, xmax, ymax, zmax] = aabb;
  const x = xmin + (xPct / 100) * (xmax - xmin);
  const z = zmin + (zPct / 100) * (zmax - zmin);
  const y = yOverride ?? (ymin + ROUTE_HEIGHT_OFFSET);
  return [x, y, z];
}

export interface ResolvedRouteNode {
  node: NavNode;
  worldPos: [number, number, number];
  floorKey: string;
}

/** Resolve every node in a route's path to a world-space position, grouped by floor. */
export function resolveRoutePositions(viewer: any, floors: FloorInfo[], route: RouteResult): ResolvedRouteNode[] {
  const aabbCache = new Map<string, Aabb6 | null>();

  return route.path.map(node => {
    const floorKey = node.floor_fm_guid ? normalizeGuid(node.floor_fm_guid) : '__global__';
    if (!aabbCache.has(floorKey)) {
      const floor = node.floor_fm_guid ? findFloorForGuid(floors, node.floor_fm_guid) : null;
      aabbCache.set(floorKey, getFloorAabb(viewer, floor));
    }
    const aabb = aabbCache.get(floorKey) || (viewer?.scene?.aabb as Aabb6 | undefined) || [0, 0, 0, 1, 1, 1];
    return { node, worldPos: pctToWorld(node.coordinates[0], node.coordinates[1], aabb), floorKey };
  });
}

export interface RouteLineSegment {
  from: [number, number, number];
  to: [number, number, number];
}

/**
 * Split a resolved route into same-floor segments (drawn as a normal path line) and
 * floor-transition risers (a straight line between a node and a synthetic point at
 * the same X/Z but the next floor's height) — a straight 3D line between two
 * different floors' plans would cut a meaningless diagonal through the building.
 */
export function buildRouteSegments(resolved: ResolvedRouteNode[]): { normal: RouteLineSegment[]; transitions: RouteLineSegment[] } {
  const normal: RouteLineSegment[] = [];
  const transitions: RouteLineSegment[] = [];

  for (let i = 0; i < resolved.length - 1; i++) {
    const a = resolved[i];
    const b = resolved[i + 1];
    if (a.floorKey === b.floorKey) {
      normal.push({ from: a.worldPos, to: b.worldPos });
    } else {
      transitions.push({ from: a.worldPos, to: [a.worldPos[0], b.worldPos[1], a.worldPos[2]] });
    }
  }

  return { normal, transitions };
}

/** Flatten line segments into the flat positions/indices arrays xeokit's LineSet expects. */
export function segmentsToLineSetArrays(segments: RouteLineSegment[]): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  segments.forEach((seg, i) => {
    positions.push(...seg.from, ...seg.to);
    indices.push(i * 2, i * 2 + 1);
  });
  return { positions, indices };
}

export interface RouteMarker {
  pos: [number, number, number];
  kind: 'start' | 'end' | 'transition';
}

/** Marker positions for the route's start, end, and any floor-transition waypoints. */
export function buildRouteMarkers(resolved: ResolvedRouteNode[], route: RouteResult): RouteMarker[] {
  if (resolved.length === 0) return [];

  const markers: RouteMarker[] = [
    { pos: resolved[0].worldPos, kind: 'start' },
    { pos: resolved[resolved.length - 1].worldPos, kind: 'end' },
  ];

  const transitionNodeIds = new Set(route.floorTransitions.map(t => t.nodeId));
  resolved.forEach(r => {
    if (transitionNodeIds.has(r.node.nodeId)) markers.push({ pos: r.worldPos, kind: 'transition' });
  });

  return markers;
}

/**
 * generateIndoorSteps() (pathfinding.ts) doesn't carry a floor_fm_guid on most steps —
 * only floor-change steps record one, via floorChange.fromFloor/toFloor. Replay the
 * transitions in order to recover which floor every step's coordinates belong to.
 * A floor-change step's own coordinates are on the *from* floor (see generateIndoorSteps).
 */
export function inferStepFloors(route: RouteResult, steps: IndoorStep[]): Array<string | null> {
  let currentFloor: string | null = route.path[0]?.floor_fm_guid ?? null;
  return steps.map(step => {
    const floorForThisStep = currentFloor;
    if (step.floorChange) currentFloor = step.floorChange.toFloor;
    return floorForThisStep;
  });
}

/** World-space position for each turn-by-turn step, for flying the camera / dropping a "you are here" marker. */
export function resolveStepWorldPositions(
  viewer: any,
  floors: FloorInfo[],
  route: RouteResult,
  steps: IndoorStep[],
): Array<[number, number, number]> {
  const stepFloors = inferStepFloors(route, steps);
  const aabbCache = new Map<string, Aabb6 | null>();

  return steps.map((step, i) => {
    const floorGuid = stepFloors[i];
    const floorKey = floorGuid ? normalizeGuid(floorGuid) : '__global__';
    if (!aabbCache.has(floorKey)) {
      const floor = floorGuid ? findFloorForGuid(floors, floorGuid) : null;
      aabbCache.set(floorKey, getFloorAabb(viewer, floor));
    }
    const aabb = aabbCache.get(floorKey) || (viewer?.scene?.aabb as Aabb6 | undefined) || [0, 0, 0, 1, 1, 1];
    return pctToWorld(step.coordinates[0], step.coordinates[1], aabb);
  });
}
