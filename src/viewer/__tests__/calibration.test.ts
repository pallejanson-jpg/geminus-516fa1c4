import { describe, it, expect } from 'vitest';
import { fitSimilarityTransform, decomposeToLegacyTransform, type CalibrationPointPair } from '../calibration';
import { transformPoint } from '../SpatialReferenceService';

function applyKnownTransform(p: { x: number; y: number; z: number }, rotationDeg: number, scale: number, offset: { x: number; y: number; z: number }) {
  const rad = (rotationDeg * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);
  return {
    x: scale * (p.x * cosR - p.z * sinR) + offset.x,
    y: p.y + offset.y,
    z: scale * (p.x * sinR + p.z * cosR) + offset.z,
  };
}

describe('fitSimilarityTransform', () => {
  it('throws for fewer than 2 pairs', () => {
    expect(() => fitSimilarityTransform([{ xeokit: { x: 0, y: 0, z: 0 }, navvis: { x: 0, y: 0, z: 0 } }])).toThrow();
  });

  it('exactly recovers a known rotation+scale+offset from 2 non-coincident points, with ~0 residual', () => {
    const rotationDeg = 30;
    const scale = 1.05;
    const offset = { x: 5, y: 1.2, z: -3 };

    const navvisPoints = [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0.5, z: 2 },
    ];
    const pairs: CalibrationPointPair[] = navvisPoints.map((navvis) => ({
      navvis,
      xeokit: applyKnownTransform(navvis, rotationDeg, scale, offset),
    }));

    const result = fitSimilarityTransform(pairs);

    expect(result.rotationDeg).toBeCloseTo(rotationDeg, 4);
    expect(result.scale).toBeCloseTo(scale, 4);
    expect(result.offset.x).toBeCloseTo(offset.x, 4);
    expect(result.offset.y).toBeCloseTo(offset.y, 4);
    expect(result.offset.z).toBeCloseTo(offset.z, 4);
    expect(result.residualErrorMm).toBeLessThan(1e-6);
  });

  it('produces a nonzero but small residual for 3+ points with a known transform plus noise', () => {
    const rotationDeg = -15;
    const scale = 1.0;
    const offset = { x: -2, y: 0, z: 1 };

    const navvisPoints = [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 0, y: 0, z: 3 },
      { x: 2, y: 0, z: 2 },
    ];
    const noiseMm = 5; // 5mm of jitter added to each "measured" xeokit point
    const pairs: CalibrationPointPair[] = navvisPoints.map((navvis, i) => {
      const exact = applyKnownTransform(navvis, rotationDeg, scale, offset);
      const jitter = (i % 2 === 0 ? 1 : -1) * (noiseMm / 1000);
      return { navvis, xeokit: { x: exact.x + jitter, y: exact.y, z: exact.z } };
    });

    const result = fitSimilarityTransform(pairs);

    expect(result.rotationDeg).toBeCloseTo(rotationDeg, 0);
    expect(result.residualErrorMm).toBeGreaterThan(0);
    expect(result.residualErrorMm).toBeLessThan(noiseMm * 2);
  });

  it('the returned transform, applied via transformPoint, matches the manual prediction used for residuals', () => {
    const navvisPoints = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
    ];
    const rotationDeg = 45;
    const scale = 0.9;
    const offset = { x: 1, y: 0, z: 1 };
    const pairs: CalibrationPointPair[] = navvisPoints.map((navvis) => ({
      navvis,
      xeokit: applyKnownTransform(navvis, rotationDeg, scale, offset),
    }));

    const result = fitSimilarityTransform(pairs);
    for (const pair of pairs) {
      const predicted = transformPoint(pair.navvis, result.transform);
      expect(predicted.x).toBeCloseTo(pair.xeokit.x, 4);
      expect(predicted.y).toBeCloseTo(pair.xeokit.y, 4);
      expect(predicted.z).toBeCloseTo(pair.xeokit.z, 4);
    }
  });
});

describe('decomposeToLegacyTransform', () => {
  it('round-trips rotation, scale, and offsets from a fitted matrix', () => {
    const rotationDeg = 22.5;
    const scale = 1.1;
    const offset = { x: 2, y: -1, z: 4 };
    const navvisPoints = [{ x: 0, y: 0, z: 0 }, { x: 3, y: 1, z: 2 }];
    const pairs: CalibrationPointPair[] = navvisPoints.map((navvis) => ({
      navvis,
      xeokit: applyKnownTransform(navvis, rotationDeg, scale, offset),
    }));
    const { matrix4x4 } = fitSimilarityTransform(pairs);

    const legacy = decomposeToLegacyTransform(matrix4x4);
    expect(legacy.rotation).toBeCloseTo(rotationDeg, 4);
    expect(legacy.scale).toBeCloseTo(scale, 4);
    expect(legacy.offsetX).toBeCloseTo(offset.x, 4);
    expect(legacy.offsetY).toBeCloseTo(offset.y, 4);
    expect(legacy.offsetZ).toBeCloseTo(offset.z, 4);
  });

  it('returns scale 1 and rotation 0 for the plain identity-equivalent matrix', () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const legacy = decomposeToLegacyTransform(identity);
    expect(legacy.rotation).toBeCloseTo(0);
    expect(legacy.scale).toBeCloseTo(1);
    expect(legacy.offsetX).toBe(0);
    expect(legacy.offsetY).toBe(0);
    expect(legacy.offsetZ).toBe(0);
  });
});
