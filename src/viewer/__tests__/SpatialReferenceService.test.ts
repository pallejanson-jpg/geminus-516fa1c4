import { describe, it, expect } from 'vitest';
import {
  normalizeHeadingDeg,
  headingDeltaDeg,
  buildOffsetRotationTransform,
  buildTransformFromBuildingSettings,
  transformPoint,
  transformHeadingDeg,
  invertTransform,
  isIdentityTransform,
  IDENTITY_POSE_TRANSFORM,
} from '../SpatialReferenceService';
import { ivionToBim, bimToIvion, ivionHeadingToBim } from '@/lib/ivion-bim-transform';

describe('normalizeHeadingDeg', () => {
  it('leaves in-range values unchanged', () => {
    expect(normalizeHeadingDeg(0)).toBe(0);
    expect(normalizeHeadingDeg(180)).toBe(180);
    expect(normalizeHeadingDeg(359.9)).toBeCloseTo(359.9);
  });

  it('wraps values >= 360 down into [0, 360)', () => {
    expect(normalizeHeadingDeg(360)).toBe(0);
    expect(normalizeHeadingDeg(370)).toBe(10);
    expect(normalizeHeadingDeg(720 + 45)).toBe(45);
  });

  it('wraps negative values up into [0, 360)', () => {
    expect(normalizeHeadingDeg(-10)).toBe(350);
    expect(normalizeHeadingDeg(-360)).toBe(0);
    expect(normalizeHeadingDeg(-720 - 30)).toBe(330);
  });
});

describe('headingDeltaDeg', () => {
  it('is 0 for identical headings', () => {
    expect(headingDeltaDeg(45, 45)).toBe(0);
  });

  it('handles the wraparound case (359 vs 1 is a 2 degree difference, not 358)', () => {
    expect(headingDeltaDeg(359, 1)).toBeCloseTo(2);
    expect(headingDeltaDeg(1, 359)).toBeCloseTo(2);
  });

  it('caps at 180 for opposite headings', () => {
    expect(headingDeltaDeg(0, 180)).toBeCloseTo(180);
  });
});

describe('transformPoint / invertTransform round-trip', () => {
  it('identity transform leaves points unchanged', () => {
    const p = { x: 1, y: 2, z: 3 };
    expect(transformPoint(p, IDENTITY_POSE_TRANSFORM)).toEqual(p);
    expect(isIdentityTransform(IDENTITY_POSE_TRANSFORM)).toBe(true);
  });

  it('forward then inverse recovers the original point (offset + rotation)', () => {
    const transform = buildOffsetRotationTransform(5, 0, -3, 37);
    const original = { x: 10, y: 2, z: -4 };
    const forward = transformPoint(original, transform);
    const back = transformPoint(forward, invertTransform(transform));

    expect(back.x).toBeCloseTo(original.x, 6);
    expect(back.y).toBeCloseTo(original.y, 6);
    expect(back.z).toBeCloseTo(original.z, 6);
  });

  it('matches the legacy ivionToBim/bimToIvion math exactly for the same parameters', () => {
    const offsetX = 12.5, offsetY = 0, offsetZ = -7.25, rotation = 63;
    const transform = buildOffsetRotationTransform(offsetX, offsetY, offsetZ, rotation);
    const legacyTransform = { offsetX, offsetY, offsetZ, rotation };

    const point = { x: 3.4, y: 1.1, z: -8.9 };
    const viaMatrix = transformPoint(point, transform);
    const viaLegacy = ivionToBim(point, legacyTransform);

    expect(viaMatrix.x).toBeCloseTo(viaLegacy.x, 9);
    expect(viaMatrix.y).toBeCloseTo(viaLegacy.y, 9);
    expect(viaMatrix.z).toBeCloseTo(viaLegacy.z, 9);

    const back = transformPoint(viaMatrix, invertTransform(transform));
    const legacyBack = bimToIvion(viaLegacy, legacyTransform);
    expect(back.x).toBeCloseTo(legacyBack.x, 6);
    expect(back.z).toBeCloseTo(legacyBack.z, 6);
  });

  it('buildTransformFromBuildingSettings defaults nulls to identity', () => {
    const transform = buildTransformFromBuildingSettings({});
    expect(isIdentityTransform(transform)).toBe(true);
  });
});

describe('transformHeadingDeg', () => {
  it('matches legacy ivionHeadingToBim for a pure rotation transform', () => {
    const rotation = 42;
    const transform = buildOffsetRotationTransform(0, 0, 0, rotation);
    const heading = 100;
    expect(transformHeadingDeg(heading, transform)).toBeCloseTo(
      normalizeHeadingDeg(ivionHeadingToBim(heading, { offsetX: 0, offsetY: 0, offsetZ: 0, rotation })),
      6,
    );
  });

  it('is a no-op (mod normalization) for the identity transform', () => {
    expect(transformHeadingDeg(275, IDENTITY_POSE_TRANSFORM)).toBeCloseTo(275, 6);
  });
});
