/**
 * Typed Event Bus — thin wrapper around window.CustomEvent.
 *
 * Provides compile-time type safety for all viewer events while remaining
 * fully compatible with existing window.addEventListener/dispatchEvent code.
 *
 * Usage:
 *   import { emit, on } from '@/lib/event-bus';
 *   emit('INSIGHTS_COLOR_UPDATE', { mode: 'temperature', colorMap: { ... } });
 *   const off = on('FLOOR_SELECTION_CHANGED', (detail) => { ... });
 *   // cleanup:
 *   off();
 */

// ── Detail types (canonical source) ─────────────────────────────────────

export interface ViewModeRequestedDetail {
  mode: '2d' | '3d';
}

export interface FloorSelectionEventDetail {
  floorId: string | null;
  floorName?: string | null;
  bounds?: { minY: number; maxY: number } | null;
  visibleMetaFloorIds?: string[];
  visibleFloorFmGuids?: string[];
  isAllFloorsVisible?: boolean;
  isSoloFloor?: boolean;
  soloFloorName?: string;
  /** When true, listeners should NOT apply section-plane clipping (visibility already handled). */
  skipClipping?: boolean;
  fromFilterPanel?: boolean;
}

export interface ViewModeEventDetail {
  mode: '2d' | '3d';
  floorId?: string | null;
}

export interface ClipHeightEventDetail {
  height: number;
}

export interface ViewerContextChangedDetail {
  buildingFmGuid: string;
  buildingName?: string;
  viewMode: '2d' | '3d';
  visibleFloorFmGuids: string[];
  visibleModelIds: string[];
  selectedFmGuids: string[];
  clipHeight: number;
}

export interface ViewerToolChangedDetail {
  tool: 'select' | 'measure' | 'slicer' | null;
}

export interface InsightsColorUpdateDetail {
  mode: string;
  colorMap: Record<string, [number, number, number]>;
  nameColorMap?: Record<string, [number, number, number]>;
  strictGuidMode?: boolean;
  entityColorMap?: Record<string, [number, number, number]>;
}

export interface AlarmAnnotationsShowDetail {
  alarms: { fmGuid: string; roomFmGuid?: string }[];
  flyTo?: boolean;
  visible?: boolean;
}

export interface AnnotationFilterDetail {
  visibleCategories: string[];
}

export interface ViewMode2DToggledDetail {
  enabled: boolean;
}

export interface IssueMarkerClickedDetail {
  issueId: string;
}

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

export interface IssueAnnotationsToggleDetail {
  visible: boolean;
}

export interface SensorAnnotationsToggleDetail {
  visible: boolean;
}

export interface FmAccessContextChangedDetail {
  objectId?: string;
  objectType?: string;
  buildingGuid?: string;
  floorGuid?: string;
  roomGuid?: string;
  raw?: any;
}

export interface SplitPlanNavigateDetail {
  worldPos: [number, number, number];
}

export interface ViewerSelectEntityDetail {
  entityId: string;
  fmGuid: string | null;
  entityName: string | null;
}

export interface ModelLoadRequestedDetail {
  modelId: string;
}

export interface ModelVisibilityChangedDetail {
  buildingFmGuid?: string;
  visibleModelIds: string[];
}

// ── Event Map ───────────────────────────────────────────────────────────

export interface EventMap {
  // Viewer lifecycle
  VIEW_MODE_REQUESTED: ViewModeRequestedDetail;
  VIEW_MODE_CHANGED: ViewModeEventDetail;
  VIEW_MODE_2D_TOGGLED: ViewMode2DToggledDetail;
  VIEWER_CONTEXT_CHANGED: ViewerContextChangedDetail;
  VIEWER_TOOL_CHANGED: ViewerToolChangedDetail;
  VIEWER_SELECT_ENTITY: ViewerSelectEntityDetail;
  VIEWER_CREATE_ASSET: void;
  VIEWER_MODELS_LOADED: { buildingFmGuid: string };
  AI_VIEWER_FOCUS: void;

  // Floor / clip
  FLOOR_SELECTION_CHANGED: FloorSelectionEventDetail;
  CLIP_HEIGHT_CHANGED: ClipHeightEventDetail;
  CLIP_HEIGHT_3D_CHANGED: ClipHeightEventDetail;
  FLOOR_VISIBILITY_APPLIED: void;
  FLOOR_TILE_SWITCH: { tiles: Array<{ modelId: string }>; floorFmGuid: string };

  // Model loading
  MODEL_LOAD_REQUESTED: ModelLoadRequestedDetail;
  MODEL_VISIBILITY_CHANGED: ModelVisibilityChangedDetail;
  SECONDARY_MODELS_AVAILABLE: { models: Array<{ model_id: string; model_name: string }> };

  // Insights / visualization
  INSIGHTS_COLOR_UPDATE: InsightsColorUpdateDetail;
  INSIGHTS_COLOR_RESET: void;
  ALARM_ANNOTATIONS_SHOW: AlarmAnnotationsShowDetail;
  FORCE_SHOW_SPACES: { show?: boolean; floorGuids?: string[]; enabled?: boolean };
  VISUALIZATION_STATE_CHANGED: { visualizationType: string; useMockData: boolean; rooms: any[] };

  // Annotations
  ANNOTATION_FILTER: AnnotationFilterDetail;
  ANNOTATION_REFRESH: void;
  TOGGLE_ANNOTATIONS: { show?: boolean; visibleCategories?: string[] };
  ISSUE_ANNOTATIONS_TOGGLE: IssueAnnotationsToggleDetail;
  SENSOR_ANNOTATIONS_TOGGLE: SensorAnnotationsToggleDetail;
  ISSUE_MARKER_CLICKED: IssueMarkerClickedDetail;

  // Saved views
  LOAD_SAVED_VIEW: LoadSavedViewDetail;

  // Navigation
  MINIMAP_TOGGLE: void;
  SPLIT_PLAN_NAVIGATE: SplitPlanNavigateDetail;
  NAV_SPEED_CHANGED: { speed: number };
  NAV_SPEED_GRANULAR: { zoom?: number; pan?: number; rotate?: number };
  FASTNAV_TOGGLE: { enabled: boolean };

  // FM Access
  FM_ACCESS_CONTEXT_CHANGED: FmAccessContextChangedDetail;

  // Inventory
  INVENTORY_POSITION_PICKED: { x: number; y: number; z: number };

  // Theme
  VIEWER_THEME_REQUESTED: { themeId: string };
  ARCHITECT_BACKGROUND_CHANGED: { presetId: string };

  // Mobile
  MOBILE_TOGGLE_FILTER_PANEL: void;
  MOBILE_TOGGLE_VIZ_MENU: void;

  // Asset panel
  TOGGLE_ASSET_PANEL: void;

  // Room labels
  ROOM_LABELS_TOGGLE: { enabled: boolean };
  ROOM_LABELS_CONFIG: any;

  // Zoom
  VIEWER_ZOOM_TO_OBJECT: { fmGuid: string };
  VIEWER_FLY_TO: { fmGuid: string };

  // Visualization quick select
  VISUALIZATION_QUICK_SELECT: { type: string };

  // Toolbar settings
  TOOLBAR_SETTINGS_CHANGED: void;

  // Floor pills
  FLOOR_PILLS_TOGGLE: { visible: boolean };

  // Theme
  VIEWER_THEME_CHANGED: { themeId: string };

  // Issue list
  OPEN_ISSUE_LIST: void;

  // Navigation panel
  TOGGLE_NAVIGATION_PANEL: void;

  // Voice commands
  VOICE_FLOOR_SELECT: { floorNumber: string };
  VOICE_CREATE_ISSUE: void;
  VOICE_CLEAR_FILTERS: void;

  // Initial visualization
  INITIAL_VISUALIZATION_REQUESTED: { type: string };

  // Gunnar
  GUNNAR_AUTO_OPEN_VOICE: void;

  // Architect mode
  ARCHITECT_MODE_REQUESTED: { enabled: boolean };
  ARCHITECT_MODE_CHANGED: { enabled: boolean };

  // Lighting
  LIGHTING_CHANGED: { enabled: boolean };
  SUN_STUDY_CHANGED: { enabled: boolean };

  // Modifications
  REAPPLY_MODIFICATIONS: void;

  // Object manipulation
  OBJECT_MOVE_MODE: { entityId: string; fmGuid: string };
  OBJECT_DELETE: { entityId: string; fmGuid: string };

  // AI viewer bridge
  AI_VIEWER_COMMAND: { action: 'highlight' | 'filter' | 'colorize' | 'reset'; entityIds?: string[]; colorMap?: Record<string, [number, number, number]> };
}

// ── emit / on / off ─────────────────────────────────────────────────────

/**
 * Emit a typed event on the window.
 * Compatible with existing window.addEventListener calls.
 */
export function emit<K extends keyof EventMap>(
  event: K,
  ...args: EventMap[K] extends void ? [] : [detail: EventMap[K]]
): void {
  const detail = args[0] as any;
  window.dispatchEvent(new CustomEvent(event, detail !== undefined ? { detail } : undefined));
}

/**
 * Listen for a typed event on the window.
 * Returns an unsubscribe function.
 */
export function on<K extends keyof EventMap>(
  event: K,
  handler: EventMap[K] extends void ? () => void : (detail: EventMap[K]) => void,
): () => void {
  const listener = (e: Event) => {
    (handler as Function)((e as CustomEvent).detail);
  };
  window.addEventListener(event, listener);
  return () => window.removeEventListener(event, listener);
}
