

# Plan: Fix 6 Viewer Issues for Demo

## Issues Summary

1. **Performance degrades** when using Filter/Section tools
2. **Saved views don't restore** camera, floors, models, section planes
3. **Småviken shows wrong floors** in Filter menu (non-A model floors leaking in)
4. **Space checkbox flies inside** room instead of outside
5. **Space name click selects** room (green highlight) — should fly inside without selection
6. **Viewer theme randomly resets** to Model Native when using Filter menu

---

## Root Causes & Fixes

### 1. Performance: Filter panel iterates all scene objects on every change

**Problem**: `applyFilterVisibility` iterates `scene.objectIds` (potentially 50k+ entities) inside `requestAnimationFrame`, and the 300ms debounce still triggers frequently. The space cutaway code (lines 1180-1350) does an O(n²) bounding-box check against ALL metaObjects for spatial containment.

**Fix** in `ViewerFilterPanel.tsx`:
- Increase debounce from 300ms → 500ms
- Cache the `entityToModelId` map in a ref instead of rebuilding on every filter call
- In the space cutaway O(n²) loop (line 1210), limit iteration to entities on the same storey only (already partially done but the `Object.entries(metaObjects)` scans everything)
- Use `scene.setObjectsVisible(toHide, false)` batch call instead of per-entity loops where possible (already done for most cases, verify no regressions)

### 2. Saved views: `applySavedView` only sets camera — ignores floors, models, section planes

**Problem**: `applySavedView` in `NativeViewerShell.tsx` (line 65-76) only restores camera position and dispatches view mode. It ignores `visibleFloorIds`, `visibleModelIds`, `clipHeight`, `showSpaces`, `showAnnotations`.

**Fix** in `NativeViewerShell.tsx` `applySavedView`:
- After setting camera, dispatch `FLOOR_SELECTION_CHANGED_EVENT` with the saved `visibleFloorIds`
- Apply `clipHeight` via `CLIP_HEIGHT_CHANGED_EVENT`
- Toggle model visibility using `scene.models`
- Set showSpaces via `FORCE_SHOW_SPACES_EVENT`
- Add section plane data to `saved_views` table (new column `section_planes jsonb[]`) and save/restore active section planes

**Database migration**: Add `section_planes` column to `saved_views`:
```sql
ALTER TABLE saved_views ADD COLUMN section_planes jsonb DEFAULT null;
```

**Also update** `LoadSavedViewDetail` interface to include `sectionPlanes`.

**Update save logic** in `VisualizationToolbar.tsx` and `ViewerRightPanel.tsx` to capture active section planes from `viewer.scene.sectionPlanes`.

### 3. Småviken floors: non-A model floors shown

**Problem**: The `levels` useMemo (line 230) filters by `isArchitecturalModel(storey.sourceName)`, but the fallback at line 237 shows ALL storeys if no A-model storeys are identified. In Småviken, `sourceName` may be a GUID (failing the `isGuid` check at line 233) or the `parentCommonName` field is missing.

**Fix** in `ViewerFilterPanel.tsx`:
- Improve the A-model storey detection: also check the xeokit scene model IDs against `isArchitecturalModel`
- When `sourceName` is a GUID, try to look up the model name from `sharedModels` or `sourceNameLookup` before falling back
- Remove the "show all" fallback (line 237) — if no A-model storeys identified, match against loaded scene model names instead

### 4. Space checkbox: flies inside instead of outside

**Problem**: `handleSpaceToggle` (line 1523) correctly flies OUTSIDE with expanded AABB. But `applyFilterVisibility` (triggered 300ms later by debounce) has its own fly-inside logic at line 1325-1350 that overrides it when `checkedSpaces.size > 0`.

**Fix** in `ViewerFilterPanel.tsx`:
- Remove the auto fly-inside from `applyFilterVisibility` (lines 1325-1350). The fly behavior should ONLY be triggered by explicit user interactions (`handleSpaceToggle` for checkbox, `handleSpaceClick` for name click), not by the general filter application.

### 5. Space name click: should NOT select (green)

**Problem**: `handleSpaceClick` (line 1550) sets `entity.selected = true` which causes green highlight.

**Fix** in `ViewerFilterPanel.tsx`:
- Remove `entity.selected = true` from `handleSpaceClick`
- Remove the `setObjectsSelected` deselect call too — name click should only fly inside, not alter selection state
- Keep the fly-inside camera logic as-is

### 6. Theme randomly resets

**Problem**: Multiple places reset colorize without checking the active theme:
- `applyFilterVisibility` line 821 checks `themeActive` but the space cutaway (line 1321) does `entity.colorize = null` unconditionally
- The cleanup effect (line 1487) does `setObjectsColorized(false)` unconditionally before re-requesting theme
- When filter changes fire rapidly, the theme re-apply event may arrive between filter applications, causing a flash

**Fix** in `ViewerFilterPanel.tsx`:
- After `applyFilterVisibility` completes (after line 1389), re-apply the active theme if one exists by dispatching `VIEWER_THEME_REQUESTED_EVENT`
- In the space cutaway, don't set `colorize = null` — instead use theme color if theme is active
- Ensure the cleanup effect (line 1487) re-applies theme synchronously using imported `applyTheme` or requests it BEFORE showing all objects

---

## Files to Modify

1. **`src/components/viewer/ViewerFilterPanel.tsx`** — Issues 1, 3, 4, 5, 6
2. **`src/components/viewer/NativeViewerShell.tsx`** — Issue 2 (applySavedView)
3. **`src/lib/viewer-events.ts`** — Issue 2 (add sectionPlanes to LoadSavedViewDetail)
4. **`src/components/viewer/VisualizationToolbar.tsx`** — Issue 2 (save section planes)
5. **`src/components/viewer/ViewerRightPanel.tsx`** — Issue 2 (save section planes)
6. **Database migration** — Issue 2 (add section_planes column)

