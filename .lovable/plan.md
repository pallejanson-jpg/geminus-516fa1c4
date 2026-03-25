

# Fix Room Colorization, Red Room Bug, and Room Count

## Problem Summary

1. **Red rooms on floor switch**: xeokit selection state (`.selected = true`) persists across floor visibility changes. xeokit's default selected material is bright red.
2. **Room colors not visible**: `colorizeSpace` sets `opacity = 0.15` — rooms are colored but nearly transparent/invisible.
3. **Room count shows 437**: The legend bar receives ALL building rooms instead of only the rooms on the currently visible floor.

## Changes

### 1. Fix red rooms — clear selections on floor switch
**File:** `src/hooks/useFloorVisibility.ts`

In `applyFloorVisibilityToScene`, before toggling object visibility, clear all selected objects:
```ts
// Before line 127
const selected = scene.selectedObjectIds;
if (selected?.length) scene.setObjectsSelected(selected, false);
```

### 2. Fix room colorization opacity
**File:** `src/components/viewer/RoomVisualizationPanel.tsx`

In `colorizeSpace` (line 477), change `entity.opacity = 0.15` to `entity.opacity = 0.85` so rooms are clearly visible with their color. The current 0.15 makes them nearly invisible.

### 3. Fix room count to match visible floor
**File:** `src/components/viewer/RoomVisualizationPanel.tsx`

The `VISUALIZATION_STATE_CHANGED` event (line 246-252) dispatches all `rooms` to the legend overlay. The `rooms` state is already filtered by `filteredRooms` which respects `visibleFloorFmGuids`. However, on initial load `eventFloorGuids` is null and `visibleFloorFmGuidsProp` is often undefined, so the filter at line 278 is skipped and ALL 437 rooms are included.

Fix: When `eventIsAllVisible` is true AND a single floor is selected in the floor switcher, the `eventFloorGuids` should not be set to null. Update the floor event handler (line 100-101): only set `eventFloorGuids(null)` when truly all floors are visible AND no floor filtering is active. Also, rooms without a `levelFmGuid` should NOT be included when floor filtering is active (remove the `if (!room.levelFmGuid) return true` fallback at line 281).

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useFloorVisibility.ts` | Clear selections before floor visibility toggle |
| `src/components/viewer/RoomVisualizationPanel.tsx` | Fix opacity from 0.15→0.85; fix room count filtering |

