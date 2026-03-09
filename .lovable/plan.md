

## Plan: Viewer Context Menu & Selection Improvements

### Issues identified

1. **Properties opens `AssetPropertiesDialog` instead of `UniversalPropertiesDialog`** — Actually, `NativeViewerShell` already uses `UniversalPropertiesDialog` (line 671). The issue is that when no database record exists for the fmGuid, the fallback BIM metadata view is sparse. This needs investigation but may be a data issue rather than a code issue.

2. **No "Select None" in context menu** — Missing deselect-all action.

3. **Show labels only turns ON, never OFF** — `onShowLabels` always dispatches `{ show: true }`, `onShowRoomLabels` always dispatches `{ enabled: true }`. Both should toggle.

4. **Select doesn't toggle** — Clicking a selected object should deselect it. Currently always selects. No Ctrl+click multi-select.

5. **Room labels cause performance issues** — Already partially addressed by throttling (per memory), but the occlusion check may still be too heavy for large buildings.

6. **Floor not isolated in 3D when navigating from Portfolio/Navigator** — `floorFmGuid` URL param only triggers `FLOOR_SELECTION_CHANGED_EVENT` in 2D mode, not in 3D.

7. **Spaces count = 0 when filtering by level** — The spaces list actually filters correctly (lines 215-250 in ViewerFilterPanel), but the Spaces section header shows `spaces.length` which IS the filtered count. The bug is likely that `checkedLevels` doesn't get populated when using the floor switcher (only when manually checking levels in filter panel).

---

### Changes

#### 1. Add "Select None" to context menu
- **ViewerContextMenu.tsx**: Add `onSelectNone` prop and menu item (always enabled, after separator with Show all).
- **NativeViewerShell.tsx**: Wire `onSelectNone` to `scene.setObjectsSelected(scene.selectedObjectIds, false)` and close properties dialog.

#### 2. Toggle labels on/off
- **NativeViewerShell.tsx**: Track `labelsVisible` and `roomLabelsVisible` state refs. Toggle them in `onShowLabels` and `onShowRoomLabels` handlers.
- **ViewerContextMenu.tsx**: Add `labelsActive` and `roomLabelsActive` props to show check indicator.

#### 3. Select toggle + Ctrl multi-select
- **NativeViewerShell.tsx** (`handleSelectClick`):
  - If clicked entity is already selected → deselect it, close properties.
  - If Ctrl/Meta held → add to selection (don't deselect others), open properties for all selected.
  - Otherwise → deselect all, select clicked, open properties.

#### 4. Room labels performance
- **useRoomLabels.ts**: Increase throttle threshold further. Skip occlusion entirely when label count > 50 (currently 80). Reduce DOM updates by using `transform` instead of `left/top`.

#### 5. Floor isolation in 3D mode from URL param
- **UnifiedViewer.tsx**: In the `viewerReady` effect, when `viewMode === '3d'` AND `floorFmGuid` is set, dispatch `FLOOR_SELECTION_CHANGED_EVENT` the same way as 2D mode does. This triggers the floor switcher and section plane clipping to isolate that floor.

#### 6. Spaces count synced with floor switcher
- **ViewerFilterPanel.tsx**: Listen for `FLOOR_SELECTION_CHANGED_EVENT` and update `checkedLevels` when the floor switcher changes the active floor. This ensures the Spaces section shows the correct count for the isolated floor.

---

### Files to modify
- `src/components/viewer/ViewerContextMenu.tsx` — Add Select None, toggle indicators
- `src/components/viewer/NativeViewerShell.tsx` — Toggle logic for labels, select toggle, Ctrl multi-select, Select None handler
- `src/pages/UnifiedViewer.tsx` — Dispatch floor selection in 3D mode
- `src/components/viewer/ViewerFilterPanel.tsx` — Sync checkedLevels with floor switcher event
- `src/hooks/useRoomLabels.ts` — Performance: lower occlusion threshold, use CSS transform

