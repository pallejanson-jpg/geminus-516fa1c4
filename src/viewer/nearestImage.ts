/**
 * Shared "nearest spatial candidate" lookup — used to find the closest Ivion 360°
 * image to a given 3D position. Single implementation so floor-awareness only needs
 * to be correct in one place (Phase 1 requirement); src/hooks/useIvionCameraSync.ts
 * calls this instead of computing distance inline.
 *
 * Floor filtering is opt-in: if the caller doesn't pass a floorFmGuid, or none of the
 * candidates carry one (today's `get-images-for-site` response doesn't yet tag images
 * with a floor — see docs/viewer-current-state-verified.md), this behaves exactly like
 * the old flat-radius search. It only narrows the candidate set when floor data is
 * actually available on both sides.
 */

import type { Vec3 } from './types';
import { distanceMeters } from './SpatialReferenceService';

export interface SpatialCandidate {
  id: number;
  location: Vec3;
  floorFmGuid?: string | null;
}

export interface FindNearestOptions {
  /** Only consider candidates on this floor, if any candidate declares a floor. */
  floorFmGuid?: string | null;
  /** Reject matches farther than this (meters). Defaults to 50, matching legacy behavior. */
  maxDistanceMeters?: number;
}

export function findNearestCandidate<T extends SpatialCandidate>(
  position: Vec3,
  candidates: T[],
  options: FindNearestOptions = {},
): T | null {
  if (candidates.length === 0) return null;

  const maxDistance = options.maxDistanceMeters ?? 50;
  const anyHasFloor = candidates.some((c) => !!c.floorFmGuid);
  const pool =
    options.floorFmGuid && anyHasFloor
      ? candidates.filter((c) => !c.floorFmGuid || c.floorFmGuid === options.floorFmGuid)
      : candidates;

  // No fallback to the unfiltered set when a floor filter narrows the pool to empty —
  // that would silently place the sync on the wrong floor, which is the exact bug
  // this floor-awareness requirement exists to prevent.
  let nearest: T | null = null;
  let nearestDist = Infinity;
  for (const candidate of pool) {
    const dist = distanceMeters(candidate.location, position);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = candidate;
    }
  }

  return nearestDist < maxDistance ? nearest : null;
}
