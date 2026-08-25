/**
 * Layout math for auto-placing multiple 360° POIs that have no room geometry
 * to derive a position from. Spreads them in a small circle around a shared
 * anchor point so they don't all land exactly on top of each other, and can
 * still be found and dragged into place individually in the 360° viewer.
 */
import type { Point3 } from '@/lib/room-centroid';

export function distributeAroundAnchor(anchor: Point3, count: number, radiusMeters = 0.4): Point3[] {
  if (count <= 1) return [{ ...anchor }];

  const points: Point3[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    points.push({
      x: anchor.x + radiusMeters * Math.cos(angle),
      y: anchor.y,
      z: anchor.z + radiusMeters * Math.sin(angle),
    });
  }
  return points;
}
