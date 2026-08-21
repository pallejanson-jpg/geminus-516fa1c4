/**
 * ViewerCoordinator — the single broker between viewer adapters (xeokit, Ivion).
 * Replaces the ad-hoc, per-hook debounce logic in ViewerSyncContext with an
 * explicit loop-guard (Del C.2 of docs/plans/viewer-coordinator-spec-and-prompts.md).
 *
 * This module has no DOM/React dependency and is fully unit-testable.
 */

import type { SpatialPose, SpatialViewerAdapter, ViewerSelection, ViewerSource } from './types';
import { headingDeltaDeg, distanceMeters } from './SpatialReferenceService';

/** Suppress an incoming pose within this radius+heading of the current pose (anti-oscillation). */
export const POSITION_EPSILON_METERS = 0.15;
export const HEADING_EPSILON_DEGREES = 2;
/** Minimum time between two accepted poses from the SAME source. */
export const SYNC_INTERVAL_MS = 100;

export type LoopGuardReason =
  | 'accepted'
  | 'echo-transaction'
  | 'within-epsilon'
  | 'source-rate-limited';

export interface LoopGuardResult {
  accepted: boolean;
  reason: LoopGuardReason;
}

/**
 * Pure decision function for whether an incoming pose should be accepted.
 * Exported directly so its suppression rules can be unit-tested without spinning
 * up a full ViewerCoordinator/adapters.
 */
export function evaluateLoopGuard(
  candidate: SpatialPose,
  currentPose: SpatialPose | null,
  lastAcceptedAtBySource: ReadonlyMap<ViewerSource, number>,
  now: number,
): LoopGuardResult {
  // Rule 1: exact echo of a transaction the coordinator itself just broadcast.
  if (currentPose && candidate.transactionId === currentPose.transactionId) {
    return { accepted: false, reason: 'echo-transaction' };
  }

  // Rule 2: near-identical pose to what we already have (position + heading).
  if (currentPose) {
    const posDelta = distanceMeters(candidate.position, currentPose.position);
    const headingDelta =
      candidate.orientation && currentPose.orientation
        ? headingDeltaDeg(candidate.orientation.headingDeg, currentPose.orientation.headingDeg)
        : 0;
    if (posDelta < POSITION_EPSILON_METERS && headingDelta < HEADING_EPSILON_DEGREES) {
      return { accepted: false, reason: 'within-epsilon' };
    }
  }

  // Rule 3: too soon since the last accepted update FROM THE SAME SOURCE.
  const lastAcceptedAt = lastAcceptedAtBySource.get(candidate.source);
  if (lastAcceptedAt !== undefined && now - lastAcceptedAt < SYNC_INTERVAL_MS) {
    return { accepted: false, reason: 'source-rate-limited' };
  }

  return { accepted: true, reason: 'accepted' };
}

type Unsubscribe = () => void;

export class ViewerCoordinator {
  private adapters = new Map<ViewerSource, SpatialViewerAdapter>();
  private currentPose: SpatialPose | null = null;
  private lastAcceptedAtBySource = new Map<ViewerSource, number>();
  private poseListeners = new Set<(pose: SpatialPose) => void>();
  private selectionListeners = new Set<(sel: ViewerSelection) => void>();
  /** Injectable clock for tests; defaults to performance.now() per the spec. */
  private now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => performance.now());
  }

  registerAdapter(source: ViewerSource, adapter: SpatialViewerAdapter): void {
    this.adapters.set(source, adapter);
  }

  unregisterAdapter(source: ViewerSource): void {
    this.adapters.delete(source);
  }

  getPose(): SpatialPose | null {
    return this.currentPose;
  }

  /**
   * Submit a candidate pose from one of the adapters. Returns whether it was
   * accepted (and thus broadcast to listeners + all OTHER adapters) or suppressed.
   */
  submitPose(candidate: SpatialPose): LoopGuardResult {
    const now = this.now();
    const result = evaluateLoopGuard(candidate, this.currentPose, this.lastAcceptedAtBySource, now);
    if (!result.accepted) return result;

    this.currentPose = candidate;
    this.lastAcceptedAtBySource.set(candidate.source, now);

    for (const listener of this.poseListeners) listener(candidate);

    for (const [source, adapter] of this.adapters) {
      if (source === candidate.source) continue; // don't echo back to the originator
      adapter.setPose(candidate).catch(() => {
        // Adapters are expected to log their own errors; the coordinator shouldn't crash
        // one viewer's sync loop because another viewer's setPose rejected.
      });
    }

    return result;
  }

  submitSelection(selection: ViewerSelection): void {
    for (const listener of this.selectionListeners) listener(selection);
    for (const [source, adapter] of this.adapters) {
      if (source === selection.source) continue;
      adapter.selectEntity(selection).catch(() => {});
    }
  }

  onPoseChanged(cb: (pose: SpatialPose) => void): Unsubscribe {
    this.poseListeners.add(cb);
    return () => this.poseListeners.delete(cb);
  }

  onSelectionChanged(cb: (sel: ViewerSelection) => void): Unsubscribe {
    this.selectionListeners.add(cb);
    return () => this.selectionListeners.delete(cb);
  }

  /** Clear the current pose (e.g. on building change) without notifying adapters. */
  reset(): void {
    this.currentPose = null;
    this.lastAcceptedAtBySource.clear();
  }

  destroy(): void {
    this.reset();
    this.poseListeners.clear();
    this.selectionListeners.clear();
    this.adapters.clear();
  }
}
