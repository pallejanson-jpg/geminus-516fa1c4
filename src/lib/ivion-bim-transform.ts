/**
 * Ivion-to-BIM coordinate transform utilities.
 * 
 * The Ivion SDK reports positions in its own local coordinate space (meters
 * relative to the site's scan origin). The BIM model (xeokit) uses a separate
 * local coordinate space. This module provides functions to map between the two.
 * 
 * The transform is a simple 2D rotation (around Y axis) + 3D translation:
 *   1. Rotate the Ivion position by `rotation` degrees around Y
 *   2. Add offset (x, y, z)
 * 
 * The per-building transform parameters are stored in `building_settings`:
 *   - ivion_bim_offset_x/y/z (meters)
 *   - ivion_bim_rotation (degrees)
 */

export interface IvionBimTransform {
  offsetX: number;  // meters
  offsetY: number;  // meters
  offsetZ: number;  // meters
  rotation: number; // degrees (Ivion-to-BIM rotation around Y axis)
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Identity transform (no offset, no rotation) */
export const IDENTITY_TRANSFORM: IvionBimTransform = {
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  rotation: 0,
};

/** Check if a transform is identity (no alignment set) */
export function isIdentityTransform(t: IvionBimTransform): boolean {
  return t.offsetX === 0 && t.offsetY === 0 && t.offsetZ === 0 && t.rotation === 0;
}

/** Convert degrees to radians */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Transform a position from Ivion local space to BIM local space.
 * 
 * Steps:
 *   1. Rotate (x, z) around Y axis by `transform.rotation` degrees
 *   2. Add translation offsets
 */
export function ivionToBim(pos: Vec3, transform: IvionBimTransform): Vec3 {
  const rad = toRad(transform.rotation);
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);

  // Rotate around Y axis
  const rx = pos.x * cosR - pos.z * sinR;
  const rz = pos.x * sinR + pos.z * cosR;

  return {
    x: rx + transform.offsetX,
    y: pos.y + transform.offsetY,
    z: rz + transform.offsetZ,
  };
}

/**
 * Transform a position from BIM local space to Ivion local space.
 * (Inverse of ivionToBim)
 * 
 * Steps:
 *   1. Subtract translation offsets
 *   2. Rotate (x, z) around Y axis by -rotation degrees
 */
export function bimToIvion(pos: Vec3, transform: IvionBimTransform): Vec3 {
  // Remove translation
  const tx = pos.x - transform.offsetX;
  const ty = pos.y - transform.offsetY;
  const tz = pos.z - transform.offsetZ;

  // Inverse rotation (negate angle)
  const rad = toRad(-transform.rotation);
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);

  return {
    x: tx * cosR - tz * sinR,
    y: ty,
    z: tx * sinR + tz * cosR,
  };
}

/**
 * Transform a heading (yaw in degrees) from Ivion space to BIM space.
 * Simply adds the rotation offset.
 */
export function ivionHeadingToBim(heading: number, transform: IvionBimTransform): number {
  return heading + transform.rotation;
}

/**
 * Transform a heading (yaw in degrees) from BIM space to Ivion space.
 * Simply subtracts the rotation offset.
 */
export function bimHeadingToIvion(heading: number, transform: IvionBimTransform): number {
  return heading - transform.rotation;
}

/**
 * Build an IvionBimTransform from database row values.
 * Falls back to identity (zero) values for any nulls.
 */
export function buildTransformFromSettings(settings: {
  ivion_bim_offset_x?: number | null;
  ivion_bim_offset_y?: number | null;
  ivion_bim_offset_z?: number | null;
  ivion_bim_rotation?: number | null;
}): IvionBimTransform {
  return {
    offsetX: settings.ivion_bim_offset_x ?? 0,
    offsetY: settings.ivion_bim_offset_y ?? 0,
    offsetZ: settings.ivion_bim_offset_z ?? 0,
    rotation: settings.ivion_bim_rotation ?? 0,
  };
}
