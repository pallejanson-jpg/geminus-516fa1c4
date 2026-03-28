/**
 * Custom events for viewer communication between components.
 * Centralizes event names to avoid typos and enable easy discovery.
 */

/** Event dispatched when a component wants to request a view mode change (2D/3D) */
export const VIEW_MODE_REQUESTED_EVENT = 'VIEW_MODE_REQUESTED';

/** Event dispatched when view mode has actually changed */
export { VIEW_MODE_CHANGED_EVENT, FLOOR_SELECTION_CHANGED_EVENT, CLIP_HEIGHT_CHANGED_EVENT, CLIP_HEIGHT_3D_CHANGED_EVENT } from '@/hooks/useSectionPlaneClipping';

/** Event dispatched when room visualization panel wants to force "Show Spaces" on */
export { FORCE_SHOW_SPACES_EVENT } from '@/components/viewer/RoomVisualizationPanel';

/** Event dispatched when a saved view should be loaded */
export const LOAD_SAVED_VIEW_EVENT = 'LOAD_SAVED_VIEW';

/** Event dispatched when 3D viewer context changes (for Gunnar AI) */
export const VIEWER_CONTEXT_CHANGED_EVENT = 'VIEWER_CONTEXT_CHANGED';

/** Event dispatched when the active viewer tool changes (select, measure, slicer, null) */
export const VIEWER_TOOL_CHANGED_EVENT = 'VIEWER_TOOL_CHANGED';

/** Type for view mode request event detail */
export interface ViewModeRequestedDetail {
  mode: '2d' | '3d';
}

/** Type for viewer context changes (for Gunnar AI integration) */
export interface ViewerContextChangedDetail {
  buildingFmGuid: string;
  buildingName?: string;
  viewMode: '2d' | '3d';
  visibleFloorFmGuids: string[];
  visibleModelIds: string[];
  selectedFmGuids: string[];
  clipHeight: number;
}

/** Type for viewer tool change event detail */
export interface ViewerToolChangedDetail {
  tool: 'select' | 'measure' | 'slicer' | null;
}

/** Event dispatched when minimap toggle is requested from the right panel */
export const MINIMAP_TOGGLE_EVENT = 'MINIMAP_TOGGLE';

/** Event dispatched when a deferred (non-A) model should be loaded on demand */
export const MODEL_LOAD_REQUESTED_EVENT = 'MODEL_LOAD_REQUESTED';

/** Event dispatched when visible BIM model selection changes */
export const MODEL_VISIBILITY_CHANGED_EVENT = 'MODEL_VISIBILITY_CHANGED';

/** Type for model load request event detail */
export interface ModelLoadRequestedDetail {
  modelId: string;
}

/** Type for model visibility change event detail */
export interface ModelVisibilityChangedDetail {
  buildingFmGuid?: string;
  visibleModelIds: string[];
}

/** Event dispatched when Insights drawer wants to update room colorization in 3D */
export const INSIGHTS_COLOR_UPDATE_EVENT = 'INSIGHTS_COLOR_UPDATE';

/** Event dispatched when Insights drawer wants to show alarm annotations in 3D */
export const ALARM_ANNOTATIONS_SHOW_EVENT = 'ALARM_ANNOTATIONS_SHOW';

/** Type for insights color update event detail */
export interface InsightsColorUpdateDetail {
  mode: string;
  colorMap: Record<string, [number, number, number]>;
  /** Optional name-based lookup: maps a display name → color for fallback matching */
  nameColorMap?: Record<string, [number, number, number]>;
  /** When true, only match by GUID — skip name-based fallback to avoid coloring multiple rooms with same name */
  strictGuidMode?: boolean;
  /** Optional direct entity ID → color map — bypasses GUID matching entirely when provided */
  entityColorMap?: Record<string, [number, number, number]>;
}

/** Type for alarm annotations show event detail */
export interface AlarmAnnotationsShowDetail {
  alarms: { fmGuid: string; roomFmGuid?: string }[];
  flyTo?: boolean;
  /** Used by panel toggles: false hides alarm markers, true shows them */
  visible?: boolean;
}

/** Event dispatched when annotation category filter changes in ViewerFilterPanel */
export const ANNOTATION_FILTER_EVENT = 'ANNOTATION_FILTER';

/** Type for annotation filter event detail */
export interface AnnotationFilterDetail {
  visibleCategories: string[];
}

/** Event dispatched when external mode-switcher toggles xeokit 2D mode */
export const VIEW_MODE_2D_TOGGLED_EVENT = 'VIEW_MODE_2D_TOGGLED';

/** Type for view mode 2D toggle event detail */
export interface ViewMode2DToggledDetail {
  enabled: boolean;
}

/** Event dispatched when an issue annotation marker is clicked in the 3D viewer */
export const ISSUE_MARKER_CLICKED_EVENT = 'ISSUE_MARKER_CLICKED';

/** Type for issue marker click event detail */
export interface IssueMarkerClickedDetail {
  issueId: string;
}

/** Type for load saved view event detail */
export interface LoadSavedViewDetail {
  viewId: string;
  cameraEye: number[];
  cameraLook: number[];
  cameraUp: number[];
  cameraProjection: string;
  viewMode: '2d' | '3d';
  clipHeight: number;
  visibleModelIds: string[];
  visibleFloorIds: string[];
  showSpaces: boolean;
  showAnnotations: boolean;
  visualizationType: string;
  visualizationMockData: boolean;
  sectionPlanes?: Array<{ pos: number[]; dir: number[] }>;
}

/** Event dispatched when issue annotations should be toggled on/off */
export const ISSUE_ANNOTATIONS_TOGGLE_EVENT = 'ISSUE_ANNOTATIONS_TOGGLE';

/** Type for issue annotations toggle event detail */
export interface IssueAnnotationsToggleDetail {
  visible: boolean;
}

/** Event dispatched when sensor annotations should be toggled on/off */
export const SENSOR_ANNOTATIONS_TOGGLE_EVENT = 'SENSOR_ANNOTATIONS_TOGGLE';

/** Type for sensor annotations toggle event detail */
export interface SensorAnnotationsToggleDetail {
  visible: boolean;
}

/** Event dispatched when FM Access context changes (building/floor/room navigation) */
export const FM_ACCESS_CONTEXT_CHANGED_EVENT = 'FM_ACCESS_CONTEXT_CHANGED';

/** Type for FM Access context change event detail */
export interface FmAccessContextChangedDetail {
  objectId?: string;
  objectType?: string;
  buildingGuid?: string;
  floorGuid?: string;
  roomGuid?: string;
  raw?: any;
}

/** Event dispatched to reset 3D colorization (clear xray + restore architect colors) */
export const INSIGHTS_COLOR_RESET_EVENT = 'INSIGHTS_COLOR_RESET';

/** Event dispatched when 2D plan click wants to navigate 3D camera in split mode */
export const SPLIT_PLAN_NAVIGATE_EVENT = 'SPLIT_PLAN_NAVIGATE';

/** Type for split plan navigate event detail */
export interface SplitPlanNavigateDetail {
  worldPos: [number, number, number];
}

/** Event dispatched when an entity is selected in the 2D plan view */
export const VIEWER_SELECT_ENTITY_EVENT = 'VIEWER_SELECT_ENTITY';

/** Type for viewer select entity event detail */
export interface ViewerSelectEntityDetail {
  entityId: string;
  fmGuid: string | null;
  entityName: string | null;
}

/** Event dispatched when "Create Asset" is triggered from context menu or mobile button */
export const VIEWER_CREATE_ASSET_EVENT = 'VIEWER_CREATE_ASSET';

/** Event dispatched when asset position has been picked in 3D */
export const INVENTORY_POSITION_PICKED_EVENT = 'INVENTORY_POSITION_PICKED';

/** Event dispatched to request annotation refresh after new asset saved */
export const ANNOTATION_REFRESH_EVENT = 'ANNOTATION_REFRESH';

/** Event dispatched when AI wants to focus the viewer (e.g. after colorize/highlight on mobile) */
export const AI_VIEWER_FOCUS_EVENT = 'AI_VIEWER_FOCUS';
