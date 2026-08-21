/**
 * Core types for the ViewerCoordinator — the single broker between the xeokit
 * (BIM) viewer and the NavVis Ivion (360°) viewer.
 *
 * See docs/plans/viewer-coordinator-spec-and-prompts.md ("Del C.1") for the design
 * this implements, and docs/viewer-current-state-verified.md (Phase 0) for how it
 * maps onto the actual code (NativeXeokitViewer is the only live xeokit path today —
 * no Vue wrapper to support).
 */

export type ViewerSource = 'xeokit' | 'ivion' | 'system';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SpatialOrientation {
  headingDeg: number;
  pitchDeg: number;
  rollDeg?: number;
}

export interface SpatialPose {
  buildingFmGuid: string;
  floorFmGuid?: string;
  position: Vec3;
  orientation?: SpatialOrientation;
  coordinateSystem: 'geminus-local';
  /** performance.now() timestamp — never Date.now() (see SpatialReferenceService). */
  timestamp: number;
  source: ViewerSource;
  /** Set by whichever adapter initiated this pose change; used for echo suppression. */
  transactionId: string;
}

export interface ViewerSelection {
  assetFmGuid?: string;
  /** Corresponds to geometry_entity_map.external_entity_id */
  bimEntityId?: string;
  ivionPoiId?: number;
  source: ViewerSource;
}

/**
 * Placeholder annotation shapes for the SpatialViewerAdapter interface.
 * Phase 1 does not implement real annotation persistence/rendering (that's Phase 2) —
 * adapters expose these methods so the interface is complete, but implementations are
 * no-op stubs until Phase 2 wires them to the assets table + Supabase Realtime.
 */
export interface ViewerAnnotation {
  assetFmGuid: string;
  symbolId?: string | null;
  label?: string;
  pose: SpatialPose;
}

export interface ViewerAnnotationDraft {
  buildingFmGuid: string;
  floorFmGuid?: string;
  position: Vec3;
  source: ViewerSource;
}

export interface SpatialViewerAdapter {
  initialize(): Promise<void>;
  destroy(): void;
  getPose(): Promise<SpatialPose | null>;
  setPose(pose: SpatialPose): Promise<void>;
  selectEntity(selection: ViewerSelection): Promise<void>;
  showAnnotation(annotation: ViewerAnnotation): Promise<void>;
  removeAnnotation(assetFmGuid: string): Promise<void>;
  onPoseChanged(cb: (pose: SpatialPose) => void): () => void;
  onSelectionChanged(cb: (sel: ViewerSelection) => void): () => void;
  onAnnotationCreateRequested(cb: (draft: ViewerAnnotationDraft) => void): () => void;
}
