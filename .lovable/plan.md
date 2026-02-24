

## Plan: Unified Configurable Context Menu

### Current State

There are **two competing right-click menus** on the 3D canvas:

1. **Asset+ built-in menu** (DevExtreme): Hidden via CSS (`display: none !important` in `index.css`) and blocked by a capturing `contextmenu` listener on the xeokit canvas (lines 2426-2458 in `AssetPlusViewer.tsx`). The `externalCustomObjectContextMenuItems` init parameter is set to `undefined`.

2. **Geminus `ViewerContextMenu`**: Our custom React component that renders on right-click with 9 commands split into two groups (Geminus actions + Viewer actions).

The CSS hiding + capture listener approach works but is fragile. The plan is to keep only the Geminus menu and make its commands configurable.

---

### Technical Details

#### 1. Context Menu Settings Storage

New file: `src/components/viewer/ContextMenuSettings.ts`

```typescript
export const CONTEXT_MENU_SETTINGS_KEY = 'geminus-context-menu-settings';
export const CONTEXT_MENU_SETTINGS_CHANGED_EVENT = 'context-menu-settings-changed';

export interface ContextMenuItemConfig {
  id: string;
  label: string;
  visible: boolean;
  group: 'geminus' | 'viewer';
}

export const ALL_CONTEXT_MENU_ITEMS: ContextMenuItemConfig[] = [
  { id: 'properties',     label: 'Properties',        visible: true,  group: 'geminus' },
  { id: 'createIssue',    label: 'Create issue',      visible: true,  group: 'geminus' },
  { id: 'createWorkOrder',label: 'Create work order',  visible: true,  group: 'geminus' },
  { id: 'viewInSpace',    label: 'View in space',      visible: true,  group: 'viewer' },
  { id: 'select',         label: 'Select object',      visible: true,  group: 'viewer' },
  { id: 'zoomToFit',      label: 'Zoom to fit',        visible: true,  group: 'viewer' },
  { id: 'isolate',        label: 'Isolate object',     visible: true,  group: 'viewer' },
  { id: 'hideSelected',   label: 'Hide object',        visible: true,  group: 'viewer' },
  { id: 'showAll',        label: 'Show all',           visible: true,  group: 'viewer' },
];
```

Functions: `getContextMenuSettings()`, `saveContextMenuSettings()` — read/write from `localStorage`, dispatch custom event.

#### 2. Update `ViewerContextMenu.tsx`

- Replace hardcoded `MENU_ITEMS_GEMINUS` and `MENU_ITEMS_VIEWER` arrays with a dynamic list filtered by `getContextMenuSettings()`
- Only render items where `visible: true`
- Keep the same Geminus dark-theme UI (backdrop-blur, rounded-lg, etc.)
- Still group by `group` with a `<Separator>` between

#### 3. Context Menu Settings UI

New file: `src/components/settings/ContextMenuSettingsPanel.tsx`

- A list of all 9 context menu commands with toggle switches
- Grouped by "Geminus" and "Viewer" sections
- Integrated into `ProfileModal.tsx` as a new tab called "Context Menu" (alongside Profile, Gunnar, Ilean, Voice)

#### 4. Clean Up Asset+ Suppression

Keep the existing CSS hiding and capture listener — they are still necessary to prevent the Asset+ DevExtreme menu from appearing. No changes needed here since it already works.

---

### Files to Create

| File | Purpose |
|---|---|
| `src/components/viewer/ContextMenuSettings.ts` | Settings interface, defaults, localStorage helpers |
| `src/components/settings/ContextMenuSettingsPanel.tsx` | Toggle UI for configuring visible commands |

### Files to Modify

| File | Changes |
|---|---|
| `src/components/viewer/ViewerContextMenu.tsx` | Read settings, filter items dynamically |
| `src/components/settings/ProfileModal.tsx` | Add "Context Menu" tab |

