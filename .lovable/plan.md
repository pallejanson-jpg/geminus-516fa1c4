

# Fix: Floor Switcher Behavior, Clipping Heights, Model Names, Spaces Filtering

## 4 Issues to Fix

### 1. Floor switcher popover closes on selection — should stay open
**File:** `src/components/viewer/FloatingFloorSwitcher.tsx`
- Lines 152 and 159: `setPopoverOpen(false)` is called in both `handleFloorSelect` and `handleShowAll`
- **Fix:** Remove `setPopoverOpen(false)` from both handlers. The popover stays open so the user can change their mind. They close it by clicking outside or clicking the trigger again.

### 2. Clipping height differs by view mode (3D vs 2D)
**Current behavior:** 
- **3D mode** (`applyCeilingClipping`): Clips at `nextFloor.minY + 0.05` — this is correct per the user's requirement ("where the next floor starts")
- **2D mode** (`applyFloorPlanClipping`): Clips at `bounds.minY + floorCutHeight` where `floorCutHeight` defaults to `0.5m` — user says this is correct for 2D

**Problem:** The `FloatingFloorSwitcher` dispatches `FLOOR_SELECTION_CHANGED_EVENT` with bounds from `calculateFloorBounds(soloFloorId)`. The `ViewerToolbar` handler (line 237-250) then applies the correct clipping mode based on `viewModeRef.current`. This should already work correctly.

**However**, the `applyAndDispatch` in FloatingFloorSwitcher (line 125) calls `calculateFloorBounds` which returns `{ minY, maxY }` of the *current* floor's own objects. The event includes these bounds. The ViewerToolbar handler at line 245 uses `soloId` (which is the metaObjectId) to call `applyCeilingClipping(soloId)`, which internally calls `calculateClipHeightFromFloorBoundary` that finds the *next* floor's minY. This is the correct approach.

**Potential issue:** The `soloId` variable in ViewerToolbar (line 235) might not match. Let me trace: `visibleMetaFloorIds` comes from `allMetaIds` in FloatingFloorSwitcher which is `visibleFloors.flatMap(f => f.metaObjectIds)`. The ViewerToolbar checks `isSolo = !isAllFloorsVisible && visibleMetaFloorIds?.length === 1` — but if a floor has multiple metaObjectIds (merged from A+E+V models), `visibleMetaFloorIds.length` could be > 1 even when only 1 floor is selected, causing `isSolo` to be false and clipping to be removed instead of applied.

**Fix:** In `ViewerToolbar` line 234-235, check `isSoloFloor` from event detail or use `floorId` directly instead of relying on `visibleMetaFloorIds.length === 1`. The FloatingFloorSwitcher already sends `floorId` as `soloFloorId` when one floor is selected.

**File:** `src/components/viewer/ViewerToolbar.tsx` (lines 234-246)
- Change solo detection: use `e.detail.floorId !== null && !e.detail.isAllFloorsVisible` instead of checking `visibleMetaFloorIds.length === 1`
- Use `e.detail.floorId` directly for clipping calls

### 3. Model names wrong in filter panel
The `sources` memo in ViewerFilterPanel (lines 184-222) uses `apSources` from `useModelData`. If Asset+ data isn't loaded yet or parentBimObjectId/parentCommonName are missing, it falls back to `sharedModels` with `model.name`. If that name looks like a GUID, it shows "Modell 1", "Modell 2" etc.

**Root cause:** The `sharedModels` from `useModelData` should already resolve names via `useModelNames` and `storeyLookup`. Need to check that the filter panel actually uses the resolved names from sharedModels, not raw model IDs.

**Fix:** In the fallback path (lines 200-212), ensure `model.name` is already the resolved friendly name from `useModelData` (which uses `useModelNames`). If `sharedModels` already has friendly names, the issue is in strategy 1 (lines 188-197) where `apSources.get(level.sourceGuid)` returns a GUID. Add the same GUID detection there.

**File:** `src/components/viewer/ViewerFilterPanel.tsx` (lines 184-222)
- When building sources from levels, also cross-reference `sharedModels` for friendly names as a fallback when `apSources` returns a GUID or empty string

### 4. Spaces not filtering when a Level is selected via floor switcher
The `spaces` memo (line 224-302) filters by `checkedLevels`. But when the user selects a floor via the FloatingFloorSwitcher, the filter panel's `checkedLevels` state is NOT updated — only the viewer visibility changes.

The spaces should also filter based on the externally-selected floor (from floor switcher), not just `checkedLevels` from the filter panel checkboxes.

**Fix:** Listen for `FLOOR_SELECTION_CHANGED_EVENT` in the filter panel and sync `checkedLevels` when a floor is selected externally. When a solo floor is selected, find the matching level and set it as checked. When all floors are shown, clear `checkedLevels`.

**File:** `src/components/viewer/ViewerFilterPanel.tsx`
- Add a `useEffect` that listens for `FLOOR_SELECTION_CHANGED_EVENT` and updates `checkedLevels` accordingly
- Map `visibleFloorFmGuids` from the event to matching level fmGuids

## Files to Edit
1. `src/components/viewer/FloatingFloorSwitcher.tsx` — keep popover open after selection
2. `src/components/viewer/ViewerToolbar.tsx` — fix solo floor detection for clipping
3. `src/components/viewer/ViewerFilterPanel.tsx` — fix model names fallback + sync spaces with external floor selection

