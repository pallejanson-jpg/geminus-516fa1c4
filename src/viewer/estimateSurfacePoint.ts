import type { Vec3 } from '@/lib/ivion-bim-transform';

/**
 * Estimate a surface point from a NavVis panorama position + viewing direction,
 * by projecting a ray from the tripod location along the current camera direction
 * at the given distance (meters). Shared by AlignmentPointPicker.tsx (single-point
 * offset calibration) and CalibrationScreen.tsx (multi-point similarity calibration) —
 * both need the exact same ray math for the "click in the 360° view" step.
 */
export function estimateSurfacePoint(
  tripodPos: Vec3,
  viewDir: { lon: number; lat: number },
  distance: number,
): Vec3 {
  // lon = yaw (rotation around Y), lat = pitch (up/down).
  // In Ivion: lon=0 faces north (-Z), increases clockwise.
  const cosLat = Math.cos(viewDir.lat);
  return {
    x: tripodPos.x + Math.sin(viewDir.lon) * cosLat * distance,
    y: tripodPos.y + Math.sin(viewDir.lat) * distance,
    z: tripodPos.z - Math.cos(viewDir.lon) * cosLat * distance,
  };
}
