import { describe, it, expect } from 'vitest';
import { findNearestCandidate, type SpatialCandidate } from '../nearestImage';

describe('findNearestCandidate', () => {
  it('returns null for an empty candidate list', () => {
    expect(findNearestCandidate({ x: 0, y: 0, z: 0 }, [])).toBeNull();
  });

  it('returns the closest candidate within the default 50m radius', () => {
    const candidates: SpatialCandidate[] = [
      { id: 1, location: { x: 0, y: 0, z: 0 } },
      { id: 2, location: { x: 10, y: 0, z: 0 } },
      { id: 3, location: { x: 1, y: 0, z: 0 } },
    ];
    const result = findNearestCandidate({ x: 0, y: 0, z: 0 }, candidates);
    expect(result?.id).toBe(1);
  });

  it('returns null when the nearest candidate is farther than maxDistanceMeters', () => {
    const candidates: SpatialCandidate[] = [{ id: 1, location: { x: 100, y: 0, z: 0 } }];
    expect(findNearestCandidate({ x: 0, y: 0, z: 0 }, candidates)).toBeNull();
  });

  it('ignores floor when no candidate declares one (backward compatible with today\'s data)', () => {
    const candidates: SpatialCandidate[] = [
      { id: 1, location: { x: 0, y: 0, z: 0 } },
      { id: 2, location: { x: 1, y: 0, z: 0 } },
    ];
    const result = findNearestCandidate({ x: 0, y: 0, z: 0 }, candidates, { floorFmGuid: 'floor-a' });
    expect(result?.id).toBe(1);
  });

  it('filters to the requested floor when candidates declare one, even if a wrong-floor candidate is closer', () => {
    const candidates: SpatialCandidate[] = [
      { id: 1, location: { x: 0, y: 0, z: 0 }, floorFmGuid: 'floor-b' }, // closest, wrong floor
      { id: 2, location: { x: 5, y: 0, z: 0 }, floorFmGuid: 'floor-a' }, // farther, right floor
    ];
    const result = findNearestCandidate({ x: 0, y: 0, z: 0 }, candidates, { floorFmGuid: 'floor-a' });
    expect(result?.id).toBe(2);
  });

  it('returns null (does not fall back to the wrong floor) when no candidate matches the requested floor', () => {
    const candidates: SpatialCandidate[] = [
      { id: 1, location: { x: 0, y: 0, z: 0 }, floorFmGuid: 'floor-b' },
    ];
    const result = findNearestCandidate({ x: 0, y: 0, z: 0 }, candidates, { floorFmGuid: 'floor-a' });
    expect(result).toBeNull();
  });

  it('includes candidates with no floor tag as always-eligible alongside floor-tagged ones', () => {
    const candidates: SpatialCandidate[] = [
      { id: 1, location: { x: 0, y: 0, z: 0 }, floorFmGuid: null }, // untagged — should still be considered
      { id: 2, location: { x: 5, y: 0, z: 0 }, floorFmGuid: 'floor-b' },
    ];
    const result = findNearestCandidate({ x: 0, y: 0, z: 0 }, candidates, { floorFmGuid: 'floor-a' });
    expect(result?.id).toBe(1);
  });
});
