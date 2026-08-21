/**
 * Pure coordinate-transform helpers shared by both viewer adapters.
 *
 * Today the only transform in production is a Y-axis rotation + XYZ translation,
 * read from building_settings.ivion_bim_offset_x/y/z + ivion_bim_rotation (see
 * src/lib/ivion-bim-transform.ts, which this module intentionally does NOT replace —
 * that file stays wired to the legacy sync hooks until they're migrated).
 *
 * This module expresses the same transform as a 4x4 affine matrix instead, so that
 * Phase 2/3's spatial_transforms table (which stores exactly this shape —
 * matrix4x4 numeric[16]) can be plugged in later without changing any caller of
 * transformPoint()/invertTransform().
 */

import type { Vec3 } from './types';

/** A row-major 4x4 affine transform. Only the top 3 rows carry information; row 3 is always [0,0,0,1]. */
export interface PoseTransform {
  toMatrix(): number[];
}

const IDENTITY_MATRIX: number[] = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

export const IDENTITY_POSE_TRANSFORM: PoseTransform = {
  toMatrix: () => IDENTITY_MATRIX,
};

/** Normalize a heading in degrees to [0, 360). This is the ONE place heading normalization happens. */
export function normalizeHeadingDeg(deg: number): number {
  // Double-mod avoids the -0 edge case a single `wrapped < 0 ? wrapped + 360 : wrapped`
  // guard produces for inputs like -360 (where `-360 % 360` is `-0`, not `0`).
  return ((deg % 360) + 360) % 360;
}

/** Smallest circular difference between two headings in degrees, always in [0, 180]. */
export function headingDeltaDeg(a: number, b: number): number {
  const na = normalizeHeadingDeg(a);
  const nb = normalizeHeadingDeg(b);
  const diff = Math.abs(na - nb);
  return diff > 180 ? 360 - diff : diff;
}

export function distanceMeters(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Build a PoseTransform equivalent to today's building_settings offset+rotation:
 * rotate (x, z) around Y by `rotationDeg`, then translate by (offsetX, offsetY, offsetZ).
 * Matches src/lib/ivion-bim-transform.ts's ivionToBim() exactly.
 */
export function buildOffsetRotationTransform(
  offsetX: number,
  offsetY: number,
  offsetZ: number,
  rotationDeg: number,
): PoseTransform {
  const rad = toRad(rotationDeg);
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);

  const matrix: number[] = [
    cosR, 0, -sinR, offsetX,
    0, 1, 0, offsetY,
    sinR, 0, cosR, offsetZ,
    0, 0, 0, 1,
  ];

  return { toMatrix: () => matrix };
}

/** Build a transform from a building_settings row, defaulting nulls to identity (0,0,0,0). */
export function buildTransformFromBuildingSettings(settings: {
  ivion_bim_offset_x?: number | null;
  ivion_bim_offset_y?: number | null;
  ivion_bim_offset_z?: number | null;
  ivion_bim_rotation?: number | null;
}): PoseTransform {
  return buildOffsetRotationTransform(
    settings.ivion_bim_offset_x ?? 0,
    settings.ivion_bim_offset_y ?? 0,
    settings.ivion_bim_offset_z ?? 0,
    settings.ivion_bim_rotation ?? 0,
  );
}

export function isIdentityTransform(transform: PoseTransform): boolean {
  const m = transform.toMatrix();
  return m.every((v, i) => v === IDENTITY_MATRIX[i]);
}

/** Apply a 4x4 affine transform (row-major) to a point. */
export function transformPoint(point: Vec3, transform: PoseTransform): Vec3 {
  const m = transform.toMatrix();
  return {
    x: m[0] * point.x + m[1] * point.y + m[2] * point.z + m[3],
    y: m[4] * point.x + m[5] * point.y + m[6] * point.z + m[7],
    z: m[8] * point.x + m[9] * point.y + m[10] * point.z + m[11],
  };
}

/**
 * Apply just the rotation part of a transform to a heading (yaw) in degrees.
 * Assumes the transform's rotation is purely around the Y axis (true for every
 * transform this module currently constructs), and normalizes the result.
 */
export function transformHeadingDeg(headingDeg: number, transform: PoseTransform): number {
  const m = transform.toMatrix();
  // Extract the Y-axis rotation angle from the matrix's rotation block.
  const rotationRad = Math.atan2(m[8], m[0]);
  return normalizeHeadingDeg(headingDeg + (rotationRad * 180) / Math.PI);
}

/**
 * Invert a 4x4 affine transform (row-major). Generic 3x3-block inverse + translation,
 * so it keeps working for similarity transforms (uniform scale) that Phase 3's
 * calibration UI may produce, not just today's pure rotation+translation.
 */
export function invertTransform(transform: PoseTransform): PoseTransform {
  const m = transform.toMatrix();
  // 3x3 rotation/scale block
  const a = m[0], b = m[1], c = m[2];
  const d = m[4], e = m[5], f = m[6];
  const g = m[8], h = m[9], i = m[10];
  const tx = m[3], ty = m[7], tz = m[11];

  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) {
    throw new Error('SpatialReferenceService: transform is not invertible (determinant ~0)');
  }
  const invDet = 1 / det;

  // Adjugate / det = inverse of the 3x3 block
  const ia = (e * i - f * h) * invDet;
  const ib = (c * h - b * i) * invDet;
  const ic = (b * f - c * e) * invDet;
  const id = (f * g - d * i) * invDet;
  const ie = (a * i - c * g) * invDet;
  const iff = (c * d - a * f) * invDet;
  const ig = (d * h - e * g) * invDet;
  const ih = (b * g - a * h) * invDet;
  const ii = (a * e - b * d) * invDet;

  // Inverse translation: -R^-1 * t
  const itx = -(ia * tx + ib * ty + ic * tz);
  const ity = -(id * tx + ie * ty + iff * tz);
  const itz = -(ig * tx + ih * ty + ii * tz);

  const inverse: number[] = [
    ia, ib, ic, itx,
    id, ie, iff, ity,
    ig, ih, ii, itz,
    0, 0, 0, 1,
  ];

  return { toMatrix: () => inverse };
}
