

## Plan: Insights & Viewer Fixes — 8 Changes

### 1. Performance tab: Energy per Floor bar click → color in 3D

**File:** `src/components/insights/BuildingInsightsView.tsx`

**Problem:** The bar click at line 782 builds `roomColorMap` and calls `handleInsightsClick`, which dispatches `INSIGHTS_COLOR_UPDATE_EVENT`. In drawerMode this should work. The issue is that `handleInsightsClick` (line 485-528) in drawerMode dispatches the event but doesn't also enable spaces visibility first. Without spaces being visible, the coloring has no visible effect.

**Fix:** Before dispatching `INSIGHTS_COLOR_UPDATE_EVENT` in `handleInsightsClick`, also dispatch `FORCE_SHOW_SPACES_EVENT` with `{ show: true }` so spaces become visible for colorization.

### 2. Space tab: Level selector should use viewer section plane clipping

**File:** `src/components/insights/BuildingInsightsView.tsx`

**Problem:** The floor filter pills (line 892-918) only filter the data list (`setSpaceFloorFilter`). They don't dispatch `FLOOR_SELECTION_CHANGED_EVENT` to cut the 3D model to the selected floor.

**Fix:** When a floor pill is clicked, also dispatch `FLOOR_SELECTION_CHANGED_EVENT` with the matching storey fmGuids. This triggers the same section plane clipping used by the FloatingFloorSwitcher. When "All" is clicked, dispatch with `isAllFloorsVisible: true`.

### 3. Space tab: Pie chart click → color rooms in 3D

**File:** `src/components/insights/BuildingInsightsView.tsx`

**Problem:** The pie `Cell` onClick (line 956-958) only sets `selectedRoomType` for local filtering — it never dispatches a color event to the 3D viewer.

**Fix:** After setting `selectedRoomType`, also build a `roomColorMap` for the matching rooms and call `handleInsightsClick({ mode: 'room_types', colorMap })` to push colors to the viewer.

### 4. Asset tab: Add floor selector (same as Space tab)

**File:** `src/components/insights/BuildingInsightsView.tsx`

**Problem:** Asset tab (line 1139-1181) has no floor filter.

**Fix:** Add the same `spaceFloorOptions` carousel above the Asset charts. Add state `assetFloorFilter` and use it to filter asset queries by `level_fm_guid`. Also dispatch `FLOOR_SELECTION_CHANGED_EVENT` on selection.

### 5. Translate tab names to English

**File:** `src/components/insights/BuildingInsightsView.tsx`

**Fix:** Change the three Swedish tab labels:
- `🔮 Prediktivt` → `🔮 Predictive`
- `📐 Optimering` → `📐 Optimization`
- `🔍 RAG Sök` → `🔍 RAG Search`

### 6. Room Label click → same as Filter menu Space click

**File:** `src/hooks/useRoomLabels.ts`

**Problem:** `handleLabelClick` (line 327-352) either flies to the room AABB or triggers a room card callback. It doesn't match the filter panel's `handleSpaceClick` behavior (select, make visible, fly to).

**Fix:** Update `handleLabelClick` to also:
1. Deselect all previously selected objects
2. Select the room entities (set `selected = true`, `visible = true`)
3. Fly to room (already done)

This matches `ViewerFilterPanel.handleSpaceClick` (line 1389-1411).

### 7. Color filter (RoomVisualizationPanel): Fix sensor data extraction

**File:** `src/components/viewer/RoomVisualizationPanel.tsx`

**Problem:** Color filter gives no effect. The `extractSensorValue` function (in `visualization-utils.ts`) looks for attribute keys containing `sensortemperature`, `sensorco2`, etc. The `hasRealData` check (line 277-289) also looks for these keys. The assets table stores these in the `attributes` JSONB field. If the key names from Asset+ don't match (e.g. `Sensor Temperature` with space, or just `Temperature`), they won't be found.

**Fix:** 
- In `extractSensorValue`, broaden the key matching to also match `sensor temperature` (with space), `sensor_temperature` (with underscore), and plain `temperature` without prefix.
- In `RoomVisualizationPanel`, ensure `hasRealData` check matches the same broadened patterns.
- The current patterns already include `temperature` so the main issue may be case-sensitivity or the attribute key format. Add logging to diagnose: log the actual attribute keys found for the first few rooms.

### 8. Spaces default light blue + add IfcSpace to theme settings

**Files:** `src/lib/architect-colors.ts`, `src/components/settings/ViewerThemeSettings.tsx`

**Problem:** Spaces have no default color and are hidden. Need light blue default.

**Fix:**
- In `architect-colors.ts`, add `ifcspace` to the architect color palette with a light blue color (`#B8D4E3`) and low opacity (0.25).
- In `ViewerThemeSettings.tsx`, `ifcspace` is already in `IFC_CATEGORIES` (line 41) with `defaultColor: '#E5E4E3'`. Change it to light blue `#B8D4E3` and ensure the theme application respects opacity for spaces.

---

### Summary

| File | Change |
|---|---|
| `BuildingInsightsView.tsx` | Force-show spaces before coloring; floor selector dispatches clipping event; pie click colors 3D; asset floor selector; translate tabs |
| `useRoomLabels.ts` | Label click selects + highlights like filter panel |
| `RoomVisualizationPanel.tsx` | Debug/broaden sensor key matching |
| `visualization-utils.ts` | Broaden sensor key patterns |
| `architect-colors.ts` | Default light blue for IfcSpace |
| `ViewerThemeSettings.tsx` | Update IfcSpace default color |

