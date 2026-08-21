import { describe, it, expect } from 'vitest';
import {
  evaluateLoopGuard,
  ViewerCoordinator,
  POSITION_EPSILON_METERS,
  HEADING_EPSILON_DEGREES,
  SYNC_INTERVAL_MS,
} from '../ViewerCoordinator';
import type { SpatialPose } from '../types';

function makePose(overrides: Partial<SpatialPose> = {}): SpatialPose {
  return {
    buildingFmGuid: 'building-1',
    position: { x: 0, y: 0, z: 0 },
    orientation: { headingDeg: 0, pitchDeg: 0 },
    coordinateSystem: 'geminus-local',
    timestamp: 0,
    source: 'xeokit',
    transactionId: 'tx-1',
    ...overrides,
  };
}

describe('evaluateLoopGuard', () => {
  it('accepts the first pose when there is no current pose', () => {
    const result = evaluateLoopGuard(makePose(), null, new Map(), 1000);
    expect(result).toEqual({ accepted: true, reason: 'accepted' });
  });

  it('suppresses an exact echo of the transaction the coordinator just broadcast', () => {
    const current = makePose({ transactionId: 'tx-echo' });
    const incoming = makePose({ transactionId: 'tx-echo', source: 'ivion' });
    const result = evaluateLoopGuard(incoming, current, new Map(), 1000);
    expect(result).toEqual({ accepted: false, reason: 'echo-transaction' });
  });

  it('suppresses a pose within the position+heading epsilon of the current pose', () => {
    const current = makePose({ position: { x: 0, y: 0, z: 0 }, orientation: { headingDeg: 10, pitchDeg: 0 } });
    const incoming = makePose({
      transactionId: 'tx-2',
      source: 'ivion',
      position: { x: POSITION_EPSILON_METERS / 2, y: 0, z: 0 },
      orientation: { headingDeg: 10 + HEADING_EPSILON_DEGREES / 2, pitchDeg: 0 },
    });
    const result = evaluateLoopGuard(incoming, current, new Map(), 1000);
    expect(result).toEqual({ accepted: false, reason: 'within-epsilon' });
  });

  it('accepts a pose that moved beyond the position epsilon even with the same heading', () => {
    const current = makePose({ position: { x: 0, y: 0, z: 0 } });
    const incoming = makePose({
      transactionId: 'tx-3',
      source: 'ivion',
      position: { x: POSITION_EPSILON_METERS * 2, y: 0, z: 0 },
    });
    const result = evaluateLoopGuard(incoming, current, new Map(), 1000);
    expect(result.accepted).toBe(true);
  });

  it('accepts a pose that kept the same position but rotated beyond the heading epsilon', () => {
    const current = makePose({ orientation: { headingDeg: 0, pitchDeg: 0 } });
    const incoming = makePose({
      transactionId: 'tx-4',
      source: 'ivion',
      orientation: { headingDeg: HEADING_EPSILON_DEGREES * 2, pitchDeg: 0 },
    });
    const result = evaluateLoopGuard(incoming, current, new Map(), 1000);
    expect(result.accepted).toBe(true);
  });

  it('treats a heading epsilon check correctly across the 0/360 wraparound', () => {
    const current = makePose({ orientation: { headingDeg: 359.5, pitchDeg: 0 } });
    const incoming = makePose({
      transactionId: 'tx-5',
      source: 'ivion',
      orientation: { headingDeg: 0.5, pitchDeg: 0 }, // 1 degree away across the wrap, not 359
    });
    const result = evaluateLoopGuard(incoming, current, new Map(), 1000);
    expect(result).toEqual({ accepted: false, reason: 'within-epsilon' });
  });

  it('does not suppress a heading exactly at the epsilon boundary (strict less-than)', () => {
    const current = makePose({ orientation: { headingDeg: 0, pitchDeg: 0 } });
    const incoming = makePose({
      transactionId: 'tx-5b',
      source: 'ivion',
      orientation: { headingDeg: HEADING_EPSILON_DEGREES, pitchDeg: 0 },
    });
    const result = evaluateLoopGuard(incoming, current, new Map(), 1000);
    expect(result.accepted).toBe(true);
  });

  it('rate-limits a second pose from the SAME source within SYNC_INTERVAL_MS', () => {
    const current = makePose({ position: { x: 0, y: 0, z: 0 } });
    const lastAcceptedAtBySource = new Map([['ivion', 1000]] as const);
    const incoming = makePose({
      transactionId: 'tx-6',
      source: 'ivion',
      position: { x: 5, y: 0, z: 0 }, // well outside epsilon, so only the rate limit should block it
    });
    const result = evaluateLoopGuard(incoming, current, lastAcceptedAtBySource, 1000 + SYNC_INTERVAL_MS / 2);
    expect(result).toEqual({ accepted: false, reason: 'source-rate-limited' });
  });

  it('does NOT rate-limit a pose from a DIFFERENT source, even immediately after another source updated', () => {
    const current = makePose({ position: { x: 0, y: 0, z: 0 }, source: 'ivion' });
    const lastAcceptedAtBySource = new Map([['ivion', 1000]] as const);
    const incoming = makePose({
      transactionId: 'tx-7',
      source: 'xeokit',
      position: { x: 5, y: 0, z: 0 },
    });
    const result = evaluateLoopGuard(incoming, current, lastAcceptedAtBySource, 1000.1);
    expect(result.accepted).toBe(true);
  });

  it('allows a same-source pose again once SYNC_INTERVAL_MS has elapsed', () => {
    const current = makePose({ position: { x: 0, y: 0, z: 0 } });
    const lastAcceptedAtBySource = new Map([['ivion', 1000]] as const);
    const incoming = makePose({
      transactionId: 'tx-8',
      source: 'ivion',
      position: { x: 5, y: 0, z: 0 },
    });
    const result = evaluateLoopGuard(incoming, current, lastAcceptedAtBySource, 1000 + SYNC_INTERVAL_MS + 1);
    expect(result.accepted).toBe(true);
  });
});

describe('ViewerCoordinator', () => {
  it('does not echo an accepted pose back to the adapter that submitted it', async () => {
    const coordinator = new ViewerCoordinator({ now: () => 0 });
    const setPoseCalls: string[] = [];

    coordinator.registerAdapter('xeokit', {
      initialize: async () => {},
      destroy: () => {},
      getPose: async () => null,
      setPose: async () => { setPoseCalls.push('xeokit'); },
      selectEntity: async () => {},
      showAnnotation: async () => {},
      removeAnnotation: async () => {},
      onPoseChanged: () => () => {},
      onSelectionChanged: () => () => {},
      onAnnotationCreateRequested: () => () => {},
    });
    coordinator.registerAdapter('ivion', {
      initialize: async () => {},
      destroy: () => {},
      getPose: async () => null,
      setPose: async () => { setPoseCalls.push('ivion'); },
      selectEntity: async () => {},
      showAnnotation: async () => {},
      removeAnnotation: async () => {},
      onPoseChanged: () => () => {},
      onSelectionChanged: () => () => {},
      onAnnotationCreateRequested: () => () => {},
    });

    coordinator.submitPose(makePose({ source: 'xeokit', transactionId: 'tx-a' }));
    await Promise.resolve();

    expect(setPoseCalls).toEqual(['ivion']);
  });

  it('notifies pose listeners only for accepted poses', () => {
    const coordinator = new ViewerCoordinator({ now: () => 0 });
    const received: SpatialPose[] = [];
    coordinator.onPoseChanged((pose) => received.push(pose));

    coordinator.submitPose(makePose({ transactionId: 'tx-a' }));
    // Echo of the same transaction should be suppressed and not notify again.
    coordinator.submitPose(makePose({ transactionId: 'tx-a' }));

    expect(received).toHaveLength(1);
  });

  it('reset() clears current pose and per-source rate limiting', () => {
    const coordinator = new ViewerCoordinator({ now: () => 1000 });
    coordinator.submitPose(makePose({ transactionId: 'tx-a', source: 'ivion' }));
    expect(coordinator.getPose()).not.toBeNull();

    coordinator.reset();
    expect(coordinator.getPose()).toBeNull();

    // After reset, an immediate same-source pose should not be rate-limited against
    // the pre-reset timestamp.
    const result = evaluateLoopGuard(makePose({ transactionId: 'tx-b', source: 'ivion' }), null, new Map(), 1000);
    expect(result.accepted).toBe(true);
  });
});
