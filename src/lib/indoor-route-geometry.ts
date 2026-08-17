/**
 * Shared conversion between the nav graph's normalized per-floor-plan-image
 * coordinates (0-100%, see pathfinding.ts) and real-world geometry, so the
 * indoor route can be projected onto the outdoor map (Mapbox) or, eventually,
 * drawn as real geometry inside the 3D BIM viewer.
 *
 * The nav graph editor places nodes over a 2D plan image that is an
 * orthographic top-down crop of one floor's BIM geometry. x%/y% map linearly
 * onto that floor's bounding box in BIM meters, derived here from the
 * coordinates of the floor's Space (room) assets.
 */

import { localToGeo, type BuildingOrigin, type GeoCoords } from '@/lib/coordinate-transform';
import type { RouteResult, IndoorStep } from '@/lib/pathfinding';

export interface PlanBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Derive a floor's plan bounding box (BIM meters) from its room asset coordinates. */
export function computePlanBoundsFromRooms(
  rooms: Array<{ coordinate_x: number | null; coordinate_z: number | null }>
): PlanBounds | null {
  const xs = rooms.map(r => r.coordinate_x).filter((v): v is number => v != null);
  const zs = rooms.map(r => r.coordinate_z).filter((v): v is number => v != null);
  if (xs.length === 0 || zs.length === 0) return null;

  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minZ: Math.min(...zs), maxZ: Math.max(...zs),
  };
}

/**
 * Convert a nav node's normalized [0-100, 0-100] percentage coordinate to BIM meters.
 * Falls back to treating the % as meters directly when bounds are unavailable
 * (inaccurate, but avoids a silent failure).
 */
export function pctToBimLocal(xPct: number, zPct: number, bounds: PlanBounds | null, y = 0) {
  if (bounds) {
    return {
      x: bounds.minX + (xPct / 100) * (bounds.maxX - bounds.minX),
      y,
      z: bounds.minZ + (zPct / 100) * (bounds.maxZ - bounds.minZ),
    };
  }
  return { x: xPct, y, z: zPct };
}

/** Project a Dijkstra RouteResult's path onto geographic coordinates for display on an outdoor map. */
export function navRouteToGeoJSON(
  route: RouteResult,
  bounds: PlanBounds | null,
  origin: BuildingOrigin
): GeoJSON.FeatureCollection {
  const geoCoords: [number, number][] = route.path.map(n => {
    const local = pctToBimLocal(n.coordinates[0], n.coordinates[1], bounds);
    const geo = localToGeo(local, origin);
    return [geo.lng, geo.lat];
  });

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: geoCoords },
      properties: {},
    }],
  };
}

export interface IndoorStepGeo {
  instruction: string;
  distance: number;
  coordinates: GeoCoords;
  type: string;
}

/** Project generateIndoorSteps() output onto geographic coordinates for the outdoor map's step timeline. */
export function navStepsToGeoSteps(
  steps: IndoorStep[],
  bounds: PlanBounds | null,
  origin: BuildingOrigin
): IndoorStepGeo[] {
  return steps.map(s => {
    const local = pctToBimLocal(s.coordinates[0], s.coordinates[1], bounds);
    const geo = localToGeo(local, origin);
    return {
      instruction: s.instruction,
      distance: s.distance,
      coordinates: { lat: geo.lat, lng: geo.lng },
      type: s.type,
    };
  });
}
