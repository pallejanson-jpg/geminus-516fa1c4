/**
 * Multi-point xeokit<->NavVis calibration (Phase 3 of
 * docs/plans/viewer-coordinator-spec-and-prompts.md, "Del C.3").
 *
 * Convention (see the fix to supabase/migrations/20260820100000_..._representation.sql):
 * spatial_transforms.matrix4x4 maps NAVVIS -> XEOKIT (source_system='navvis',
 * target_system='xeokit') — matching src/lib/ivion-bim-transform.ts's ivionToBim() and
 * the direction src/viewer/SpatialReferenceService.ts's buildOffsetRotationTransform()
 * already builds, and the direction src/viewer/adapters/IvionViewerAdapter.ts already
 * assumes (transformPoint() for navvis->xeokit, invertTransform() for the opposite).
 *
 * Rotation is constrained to the Y axis only, matching the existing model (xeokit and
 * NavVis are both metric/gravity-aligned local spaces — the only real misalignment is a
 * horizontal rotation, an XZ translation, a vertical (Y) offset, and possibly a small
 * uniform scale mismatch). This is a "similarity transform" (rotation + uniform scale +
 * translation), not a fully general 3D affine — nothing else in this codebase supports
 * shear/non-uniform scale, and introducing it here would produce a matrix other code
 * (e.g. transformHeadingDeg's atan2-based rotation extraction) doesn't expect.
 */

import type { Vec3 } from './types';
import { buildOffsetRotationTransform, type PoseTransform } from './SpatialReferenceService';
import type { IvionBimTransform } from '@/lib/ivion-bim-transform';

export interface CalibrationPointPair {
  /** A point in xeokit (BIM) local space. */
  xeokit: Vec3;
  /** The corresponding point in NavVis (Ivion) local space. */
  navvis: Vec3;
}

export interface SimilarityFitResult {
  transform: PoseTransform;
  matrix4x4: number[];
  rotationDeg: number;
  scale: number;
  offset: Vec3;
  residualErrorMm: number;
  perPointErrorMm: number[];
}

/**
 * Fit a similarity transform (Y-axis rotation + uniform scale + XYZ translation)
 * mapping navvis -> xeokit from 2+ corresponding point pairs, via least squares.
 * Exact (zero residual) for exactly 2 non-coincident pairs; a genuine best fit for 3+.
 *
 * The XZ-plane rotation+scale+translation uses the standard closed-form 2D similarity
 * least-squares solution (equivalent to 2D Procrustes / treating each point as a
 * complex number and solving p = s*e^{i*theta}*q + t in the least-squares sense). The
 * Y axis is fit independently as a simple translation (mean of per-point Y deltas) —
 * there is no rotation or scale coupling between Y and the XZ plane in this model.
 */
export function fitSimilarityTransform(pairs: CalibrationPointPair[]): SimilarityFitResult {
  if (pairs.length < 2) {
    throw new Error('fitSimilarityTransform requires at least 2 point pairs');
  }

  const n = pairs.length;
  const qCentroid = { x: 0, z: 0 };
  const pCentroid = { x: 0, z: 0 };
  let yOffsetSum = 0;

  for (const { xeokit, navvis } of pairs) {
    qCentroid.x += navvis.x;
    qCentroid.z += navvis.z;
    pCentroid.x += xeokit.x;
    pCentroid.z += xeokit.z;
    yOffsetSum += xeokit.y - navvis.y;
  }
  qCentroid.x /= n;
  qCentroid.z /= n;
  pCentroid.x /= n;
  pCentroid.z /= n;
  const offsetY = yOffsetSum / n;

  let a = 0; // sum of dot products of centered (q, p)
  let b = 0; // sum of cross products of centered (q, p)
  let qNormSq = 0;

  for (const { xeokit, navvis } of pairs) {
    const qx = navvis.x - qCentroid.x;
    const qz = navvis.z - qCentroid.z;
    const px = xeokit.x - pCentroid.x;
    const pz = xeokit.z - pCentroid.z;

    a += qx * px + qz * pz;
    b += qx * pz - qz * px;
    qNormSq += qx * qx + qz * qz;
  }

  if (qNormSq < 1e-9) {
    throw new Error('fitSimilarityTransform: navvis points are coincident, cannot determine rotation/scale');
  }

  const rotationRad = Math.atan2(b, a);
  const scale = Math.sqrt(a * a + b * b) / qNormSq;

  const cosR = Math.cos(rotationRad);
  const sinR = Math.sin(rotationRad);
  // Translation: t = pCentroid - scale * R(theta) * qCentroid
  const offsetX = pCentroid.x - scale * (qCentroid.x * cosR - qCentroid.z * sinR);
  const offsetZ = pCentroid.z - scale * (qCentroid.x * sinR + qCentroid.z * cosR);

  const matrix4x4: number[] = [
    scale * cosR, 0, -scale * sinR, offsetX,
    0, 1, 0, offsetY,
    scale * sinR, 0, scale * cosR, offsetZ,
    0, 0, 0, 1,
  ];
  const transform: PoseTransform = { toMatrix: () => matrix4x4 };

  const perPointErrorMm = pairs.map(({ xeokit, navvis }) => {
    const predictedX = scale * (navvis.x * cosR - navvis.z * sinR) + offsetX;
    const predictedZ = scale * (navvis.x * sinR + navvis.z * cosR) + offsetZ;
    const predictedY = navvis.y + offsetY;
    const dx = predictedX - xeokit.x;
    const dy = predictedY - xeokit.y;
    const dz = predictedZ - xeokit.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) * 1000;
  });
  const residualErrorMm = Math.sqrt(
    perPointErrorMm.reduce((sum, e) => sum + e * e, 0) / perPointErrorMm.length,
  );

  return {
    transform,
    matrix4x4,
    rotationDeg: (rotationRad * 180) / Math.PI,
    scale,
    offset: { x: offsetX, y: offsetY, z: offsetZ },
    residualErrorMm,
    perPointErrorMm,
  };
}

/**
 * Decompose a stored matrix4x4 back into the legacy {offsetX,offsetY,offsetZ,rotation}
 * shape the still-live sync hooks (useIvionCameraSync.ts, useViewerCameraSync.ts,
 * useVirtualTwinSync.ts) consume, via src/lib/ivion-bim-transform.ts's IvionBimTransform.
 * Scale is intentionally dropped — those hooks have no concept of scale, matching
 * buildOffsetRotationTransform()'s pure rotation+translation model. If a saved
 * calibration has a scale meaningfully different from 1, this is a lossy bridge; the
 * caller is expected to warn (see useBuildingViewerData.ts).
 */
export function decomposeToLegacyTransform(matrix4x4: number[]): IvionBimTransform & { scale: number } {
  const rotationDeg = (Math.atan2(matrix4x4[8], matrix4x4[0]) * 180) / Math.PI;
  const scale = Math.sqrt(matrix4x4[0] ** 2 + matrix4x4[8] ** 2);
  return {
    offsetX: matrix4x4[3],
    offsetY: matrix4x4[7],
    offsetZ: matrix4x4[11],
    rotation: rotationDeg,
    scale,
  };
}

/** Re-exported for callers that just need buildOffsetRotationTransform's identity case. */
export { buildOffsetRotationTransform };
