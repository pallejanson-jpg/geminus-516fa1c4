export const CONTEXT_MENU_SETTINGS_KEY = 'geminus-context-menu-settings';
export const CONTEXT_MENU_SETTINGS_CHANGED_EVENT = 'context-menu-settings-changed';

export interface ContextMenuItemConfig {
  id: string;
  label: string;
  visible: boolean;
  group: 'geminus' | 'viewer';
}

export const ALL_CONTEXT_MENU_ITEMS: ContextMenuItemConfig[] = [
  { id: 'properties',      label: 'Properties',        visible: true, group: 'geminus' },
  { id: 'createIssue',     label: 'Create issue',      visible: true, group: 'geminus' },
  { id: 'createWorkOrder', label: 'Create work order',  visible: true, group: 'geminus' },
  { id: 'viewInSpace',     label: 'View in space',      visible: true, group: 'viewer' },
  { id: 'select',          label: 'Select object',      visible: true, group: 'viewer' },
  { id: 'zoomToFit',       label: 'Zoom to fit',        visible: true, group: 'viewer' },
  { id: 'isolate',         label: 'Isolate object',     visible: true, group: 'viewer' },
  { id: 'hideSelected',    label: 'Hide object',        visible: true, group: 'viewer' },
  { id: 'showAll',         label: 'Show all',           visible: true, group: 'viewer' },
];

export function getContextMenuSettings(): ContextMenuItemConfig[] {
  try {
    const raw = localStorage.getItem(CONTEXT_MENU_SETTINGS_KEY);
    if (!raw) return ALL_CONTEXT_MENU_ITEMS;
    const saved: ContextMenuItemConfig[] = JSON.parse(raw);
    // Merge with defaults to pick up any new items added later
    return ALL_CONTEXT_MENU_ITEMS.map((def) => {
      const match = saved.find((s) => s.id === def.id);
      return match ? { ...def, visible: match.visible } : def;
    });
  } catch {
    return ALL_CONTEXT_MENU_ITEMS;
  }
}

export function saveContextMenuSettings(items: ContextMenuItemConfig[]): void {
  localStorage.setItem(CONTEXT_MENU_SETTINGS_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(CONTEXT_MENU_SETTINGS_CHANGED_EVENT, { detail: items }));
}
