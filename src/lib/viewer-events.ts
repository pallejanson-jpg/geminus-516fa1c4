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
}
