/**
 * Custom events for viewer communication between components.
 *
 * ⚠️  MIGRATION NOTE: Prefer importing `emit` / `on` from '@/lib/event-bus'
 * for type-safe dispatching and listening. The constants below are kept for
 * backward compatibility — they resolve to the same string keys used by the
 * event bus.
 */

// Re-export all detail types from the canonical source
export type {
  ViewModeRequestedDetail,
  FloorSelectionEventDetail,
  ViewModeEventDetail,
  ClipHeightEventDetail,
  ViewerContextChangedDetail,
  ViewerToolChangedDetail,
  InsightsColorUpdateDetail,
  AlarmAnnotationsShowDetail,
  AnnotationFilterDetail,
  ViewMode2DToggledDetail,
  IssueMarkerClickedDetail,
  LoadSavedViewDetail,
  IssueAnnotationsToggleDetail,
  SensorAnnotationsToggleDetail,
  FmAccessContextChangedDetail,
  SplitPlanNavigateDetail,
  ViewerSelectEntityDetail,
  ModelLoadRequestedDetail,
  ModelVisibilityChangedDetail,
} from '@/lib/event-bus';

// ── String constants (backward compat) ──────────────────────────────────

/** Event dispatched when a component wants to request a view mode change (2D/3D) */
export const VIEW_MODE_REQUESTED_EVENT = 'VIEW_MODE_REQUESTED' as const;

/** Event dispatched when view mode has actually changed */
export const VIEW_MODE_CHANGED_EVENT = 'VIEW_MODE_CHANGED' as const;

/** Event dispatched when floor selection changes */
export const FLOOR_SELECTION_CHANGED_EVENT = 'FLOOR_SELECTION_CHANGED' as const;

/** Event dispatched when 2D clip height changes */
export const CLIP_HEIGHT_CHANGED_EVENT = 'CLIP_HEIGHT_CHANGED' as const;

/** Event dispatched when 3D clip height changes */
export const CLIP_HEIGHT_3D_CHANGED_EVENT = 'CLIP_HEIGHT_3D_CHANGED' as const;

/** Event dispatched when room visualization panel wants to force "Show Spaces" on */
export const FORCE_SHOW_SPACES_EVENT = 'FORCE_SHOW_SPACES' as const;

/** Event dispatched when a saved view should be loaded */
export const LOAD_SAVED_VIEW_EVENT = 'LOAD_SAVED_VIEW' as const;

/** Event dispatched when 3D viewer context changes (for Gunnar AI) */
export const VIEWER_CONTEXT_CHANGED_EVENT = 'VIEWER_CONTEXT_CHANGED' as const;

/** Event dispatched when the active viewer tool changes (select, measure, slicer, null) */
export const VIEWER_TOOL_CHANGED_EVENT = 'VIEWER_TOOL_CHANGED' as const;

/** Event dispatched when minimap toggle is requested from the right panel */
export const MINIMAP_TOGGLE_EVENT = 'MINIMAP_TOGGLE' as const;

/** Event dispatched when a deferred (non-A) model should be loaded on demand */
export const MODEL_LOAD_REQUESTED_EVENT = 'MODEL_LOAD_REQUESTED' as const;

/** Event dispatched when visible BIM model selection changes */
export const MODEL_VISIBILITY_CHANGED_EVENT = 'MODEL_VISIBILITY_CHANGED' as const;

/** Event dispatched when Insights drawer wants to update room colorization in 3D */
export const INSIGHTS_COLOR_UPDATE_EVENT = 'INSIGHTS_COLOR_UPDATE' as const;

/** Event dispatched when Insights drawer wants to show alarm annotations in 3D */
export const ALARM_ANNOTATIONS_SHOW_EVENT = 'ALARM_ANNOTATIONS_SHOW' as const;

/** Event dispatched when annotation category filter changes in ViewerFilterPanel */
export const ANNOTATION_FILTER_EVENT = 'ANNOTATION_FILTER' as const;

/** Event dispatched when external mode-switcher toggles xeokit 2D mode */
export const VIEW_MODE_2D_TOGGLED_EVENT = 'VIEW_MODE_2D_TOGGLED' as const;

/** Event dispatched when an issue annotation marker is clicked in the 3D viewer */
export const ISSUE_MARKER_CLICKED_EVENT = 'ISSUE_MARKER_CLICKED' as const;

/** Event dispatched when issue annotations should be toggled on/off */
export const ISSUE_ANNOTATIONS_TOGGLE_EVENT = 'ISSUE_ANNOTATIONS_TOGGLE' as const;

/** Event dispatched when sensor annotations should be toggled on/off */
export const SENSOR_ANNOTATIONS_TOGGLE_EVENT = 'SENSOR_ANNOTATIONS_TOGGLE' as const;

/** Event dispatched when FM Access context changes (building/floor/room navigation) */
export const FM_ACCESS_CONTEXT_CHANGED_EVENT = 'FM_ACCESS_CONTEXT_CHANGED' as const;

/** Event dispatched to reset 3D colorization (clear xray + restore architect colors) */
export const INSIGHTS_COLOR_RESET_EVENT = 'INSIGHTS_COLOR_RESET' as const;

/** Event dispatched when 2D plan click wants to navigate 3D camera in split mode */
export const SPLIT_PLAN_NAVIGATE_EVENT = 'SPLIT_PLAN_NAVIGATE' as const;

/** Event dispatched when an entity is selected in the 2D plan view */
export const VIEWER_SELECT_ENTITY_EVENT = 'VIEWER_SELECT_ENTITY' as const;

/** Event dispatched when "Create Asset" is triggered from context menu or mobile button */
export const VIEWER_CREATE_ASSET_EVENT = 'VIEWER_CREATE_ASSET' as const;

/** Event dispatched when asset position has been picked in 3D */
export const INVENTORY_POSITION_PICKED_EVENT = 'INVENTORY_POSITION_PICKED' as const;

/** Event dispatched to request annotation refresh after new asset saved */
export const ANNOTATION_REFRESH_EVENT = 'ANNOTATION_REFRESH' as const;

/** Event dispatched when AI wants to focus the viewer (e.g. after colorize/highlight on mobile) */
export const AI_VIEWER_FOCUS_EVENT = 'AI_VIEWER_FOCUS' as const;
