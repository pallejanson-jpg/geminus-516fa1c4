/**
 * Custom events for viewer communication between components.
 * Centralizes event names to avoid typos and enable easy discovery.
 */

/** Event dispatched when a component wants to request a view mode change (2D/3D) */
export const VIEW_MODE_REQUESTED_EVENT = 'VIEW_MODE_REQUESTED';

/** Event dispatched when view mode has actually changed */
export { VIEW_MODE_CHANGED_EVENT, FLOOR_SELECTION_CHANGED_EVENT, CLIP_HEIGHT_CHANGED_EVENT } from '@/hooks/useSectionPlaneClipping';

/** Event dispatched when room visualization panel wants to force "Show Spaces" on */
export { FORCE_SHOW_SPACES_EVENT } from '@/components/viewer/RoomVisualizationPanel';

/** Event dispatched when a saved view should be loaded */
export const LOAD_SAVED_VIEW_EVENT = 'LOAD_SAVED_VIEW';

/** Type for view mode request event detail */
export interface ViewModeRequestedDetail {
  mode: '2d' | '3d';
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
