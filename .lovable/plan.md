
# Fix Floor Selection, Navigation Context, and Room Visualization Filtering

## Problem 1: Floor Selector Always Resets to All Floors

The `FloorVisibilitySelector` (line 68-74) explicitly skips localStorage restoration and always defaults to all floors visible. When the component re-initializes (e.g., opening the right panel), the selection resets.

### Fix
- Remove the "always start fresh" override in `FloorVisibilitySelector.tsx` (lines 68-74)
- Restore localStorage-based persistence so floor selection survives across panel opens
- Add support for an `initialFloorFmGuid` prop that, when set, overrides the default to select only that floor

## Problem 2: Navigation Context Not Passed to Viewer

`UnifiedViewer.tsx` line 405 passes `fmGuid={buildingData.fmGuid}` but does NOT pass `initialFmGuidToFocus`. When the user navigates from Portfolio/Navigator to a specific floor or room, the URL has `?building=<buildingGuid>` but no entity context is forwarded. The viewer shows all floors instead of the navigated-to floor.

### Fix
- Add a `?entity=<fmGuid>` query parameter to the viewer URL (alongside `?building=`)
- In `UnifiedViewer.tsx`, read this parameter and pass it as `initialFmGuidToFocus` to `AssetPlusViewer`
- When `initialFmGuidToFocus` resolves to a Floor or Space, emit a `FLOOR_SELECTION_CHANGED_EVENT` after model load so `FloorVisibilitySelector` syncs to the correct floor
- Update navigation code (Portfolio, Navigator) to include the entity GUID in the URL

## Problem 3: Room Visualization Shows Entire Building

In the screenshot, floor "03 Etasje" is selected (solo) but "Visa rum" colors rooms on ALL floors. The `RoomVisualizationPanel` filters by `visibleFloorFmGuids` (line 217-223), but when `visibleFloorFmGuids` is undefined or empty, ALL rooms are shown.

The root issue: `RoomVisualizationPanel` receives `visibleFloorFmGuids` from `ViewerRightPanel` (line 596), which passes `visibleFloorFmGuids && visibleFloorFmGuids.length > 0 ? visibleFloorFmGuids : undefined`. But the `visibleFloorFmGuids` state in `AssetPlusViewer` may not update when floor selection changes via the `FLOOR_SELECTION_CHANGED_EVENT`.

### Fix
- In `AssetPlusViewer.tsx`, ensure `visibleFloorFmGuids` state is updated when `FLOOR_SELECTION_CHANGED_EVENT` fires (it should listen for the `visibleFloorFmGuids` field from the event detail)
- In `RoomVisualizationPanel`, when `visibleFloorFmGuids` is undefined (meaning "all floors"), still apply floor-based filtering using the currently visible floors from the event system, not "show everything"
- Additionally, when "Visa rum" is toggled ON, it should only make IfcSpace entities visible for the currently selected floors, not all floors

## Technical Details

### File: `src/components/viewer/FloorVisibilitySelector.tsx`

1. Lines 68-74: Remove the "skip localStorage" logic. Restore proper localStorage loading:
   ```typescript
   useEffect(() => {
     if (!buildingFmGuid || localStorageLoaded) return;
     const storageKey = `viewer-visible-floors-${buildingFmGuid}`;
     const saved = localStorage.getItem(storageKey);
     if (saved) {
       try {
         const ids = JSON.parse(saved);
         setVisibleFloorIds(new Set(ids));
       } catch {}
     }
     setLocalStorageLoaded(true);
   }, [buildingFmGuid, localStorageLoaded]);
   ```

2. Add prop `initialFloorFmGuid?: string` that, when provided, overrides localStorage and selects only the matching floor on first init.

3. In the initialization effect (lines 200-241), when `initialFloorFmGuid` is provided:
   - Find the floor whose `databaseLevelFmGuids` includes the given GUID
   - Set only that floor as visible instead of all

### File: `src/pages/UnifiedViewer.tsx`

1. Read `?entity=` from search params:
   ```typescript
   const entityFmGuid = searchParams.get('entity');
   ```

2. Pass to AssetPlusViewer:
   ```typescript
   <AssetPlusViewer
     fmGuid={buildingData.fmGuid}
     initialFmGuidToFocus={entityFmGuid || undefined}
     ...
   />
   ```

### File: `src/components/viewer/AssetPlusViewer.tsx`

1. Ensure the `FLOOR_SELECTION_CHANGED_EVENT` listener updates `visibleFloorFmGuids` state. Search for where this state is set and verify it reacts to floor changes.

2. When `initialFmGuidToFocus` is a Floor (IfcBuildingStorey), after model load, dispatch `FLOOR_SELECTION_CHANGED_EVENT` with only that floor selected. This ensures both `FloorVisibilitySelector` and `RoomVisualizationPanel` sync to the correct floor.

3. When `initialFmGuidToFocus` is a Space (IfcSpace), find its parent floor (`levelFmGuid`) and dispatch the event for that floor.

### File: Navigation sources (Portfolio, Navigator)

Update the navigation URLs to include `?entity=<fmGuid>`:
- When clicking a Building: `/unified-viewer?building=<buildingGuid>` (no entity -- shows all floors)
- When clicking a Floor: `/unified-viewer?building=<buildingGuid>&entity=<floorGuid>`
- When clicking a Room/Space: `/unified-viewer?building=<buildingGuid>&entity=<roomGuid>`
- When clicking an Asset: `/unified-viewer?building=<buildingGuid>&entity=<assetGuid>`

### Room Visualization Floor Filtering Fix

In `RoomVisualizationPanel.tsx` lines 216-223, the filtering logic currently skips filtering when `visibleFloorFmGuids` is undefined. The fix:
- Listen to `FLOOR_SELECTION_CHANGED_EVENT` directly in `RoomVisualizationPanel` to always know the current floor selection
- When floors are isolated, only colorize rooms on those floors
- When all floors are visible, colorize all rooms (current behavior, which is correct for "all floors" mode)

## File Summary

| File | Changes |
|---|---|
| `src/components/viewer/FloorVisibilitySelector.tsx` | Restore localStorage persistence, add `initialFloorFmGuid` prop, use it on first init |
| `src/pages/UnifiedViewer.tsx` | Read `?entity=` param, pass as `initialFmGuidToFocus` to AssetPlusViewer |
| `src/components/viewer/AssetPlusViewer.tsx` | Dispatch FLOOR_SELECTION_CHANGED_EVENT after initial focus, ensure visibleFloorFmGuids syncs with floor events |
| `src/components/viewer/RoomVisualizationPanel.tsx` | Listen to FLOOR_SELECTION_CHANGED_EVENT for floor filtering, ensure colorization respects current floor selection |
| Navigation files (Portfolio/Navigator) | Add `&entity=<fmGuid>` to viewer URLs |

## Risk Assessment

- **Floor selector persistence (low risk)**: Restoring localStorage is reverting to a previous behavior. The `initialFloorFmGuid` prop is additive.
- **Entity URL param (low risk)**: Additive change. When param is absent, behavior is unchanged (all floors shown).
- **Room visualization filtering (medium risk)**: Changing the default behavior when `visibleFloorFmGuids` is undefined could affect users who expect to see all rooms. But the current behavior is broken (shows rooms on hidden floors), so this is a bug fix.
