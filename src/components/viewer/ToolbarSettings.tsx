/**
 * ToolbarSettings — minimal exports only.
 *
 * The DnD customization dialog has been removed (over-engineered for ~8 buttons).
 * This file now only exports the ToolConfig interface, the event constant, and
 * the getter functions used by VisualizationToolbar.
 */

// Custom event name for same-tab settings updates (kept for compat)
export const TOOLBAR_SETTINGS_CHANGED_EVENT = 'toolbar-settings-changed';

export interface ToolConfig {
  id: string;
  label: string;
  visible: boolean;
  inOverflow: boolean;
}

// Navigation tools list — all always visible, no overflow
export const NAVIGATION_TOOLS: ToolConfig[] = [
  { id: 'orbit',       label: 'Orbit (rotate)',     visible: true, inOverflow: false },
  { id: 'firstPerson', label: 'First Person',       visible: true, inOverflow: false },
  { id: 'zoomIn',      label: 'Zoom In',            visible: true, inOverflow: false },
  { id: 'zoomOut',     label: 'Zoom Out',           visible: true, inOverflow: false },
  { id: 'viewFit',     label: 'Fit View',           visible: true, inOverflow: false },
  { id: 'select',      label: 'Select Object',      visible: true, inOverflow: false },
  { id: 'measure',     label: 'Measure Tool',       visible: true, inOverflow: false },
  { id: 'slicer',      label: 'Section Plane',      visible: true, inOverflow: false },
];

// Visualization tools — used by VisualizationToolbar
export const VISUALIZATION_TOOLS: ToolConfig[] = [
  { id: 'navCube',     label: 'Navigation Cube',            visible: true, inOverflow: false },
  { id: 'treeView',    label: 'Model Tree (Navigator)',     visible: true, inOverflow: false },
  { id: 'objectInfo',  label: 'Object Info (Asset+)',       visible: true, inOverflow: false },
  { id: 'properties',  label: 'Properties (Lovable)',       visible: true, inOverflow: false },
];

/** Returns navigation tool settings (all always visible). */
export const getNavigationToolSettings = (): ToolConfig[] => NAVIGATION_TOOLS;

/** Returns visualization tool settings (all always visible). */
export const getVisualizationToolSettings = (): ToolConfig[] => VISUALIZATION_TOOLS;

/** No-op — kept for backwards compatibility with any callers. */
export const saveToolbarSettings = (_tools: ToolConfig[]) => {};

export const getToolbarSettings = (): ToolConfig[] => [...NAVIGATION_TOOLS, ...VISUALIZATION_TOOLS];

export default null;
