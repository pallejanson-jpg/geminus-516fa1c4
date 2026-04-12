

# Fix: Room Heatmap Single Selection, Brighter Colors, and TypeError

## Issues Identified

### 1. Room Heatmap: Single selection colors multiple rooms
**Root cause**: `colorizeSelectedSensorRooms` (line 553-577) uses `strictGuidMode: false` and builds a `nameColorMap` that includes the selected room's `commonName`. The INSIGHTS_COLOR_UPDATE handler in `useViewerEventListeners.ts` (line 225) then matches **all rooms with the same name** via the name-based fallback — so selecting one "KORR" room colors all "KORR" rooms.

**Fix**: Set `strictGuidMode: true` in `colorizeSelectedSensorRooms` since the user is selecting a specific room by GUID, not by type. The `nameColorMap` should only be used as a last resort when GUID matching fails for the **specific selected room**, not as a broad fallback.

### 2. Insights colorization too dim in xray mode
**Root cause**: In `useViewerEventListeners.ts` line 163, colorized entities get `opacity: 0.85`. Combined with xray ghosting (fillAlpha 0.15), the colored spaces appear washed out against the transparent building.

**Fix**: Increase colorized entity opacity to `1.0` and boost the xray material contrast:
- `fillAlpha: 0.08` (down from 0.15) — dimmer ghost
- `edgeAlpha: 0.15` (down from 0.3) — less edge noise
- Entity opacity: `1.0` (up from 0.85) — full brightness

### 3. TypeError: Cannot read 'type' of undefined
**Root cause**: The error stack shows it originates from an `onClick` handler in the bundled `useBuildingViewerData` chunk. This is the pie chart `Cell` click in BuildingInsightsView where `hslStringToRgbFloat(entry.color)` processes an HSL color. The error occurs when recharts passes an undefined entry to the click handler. Adding a guard for undefined entries will prevent the crash.

## Files to Edit

### `src/components/insights/BuildingInsightsView.tsx`
- Change `colorizeSelectedSensorRooms` to use `strictGuidMode: true` (line 567)
- Add null guard on pie chart Cell click handlers for undefined entries

### `src/hooks/useViewerEventListeners.ts`
- Increase colorized entity `opacity` from `0.85` to `1.0` (line 163 and line 236)
- Reduce xray material `fillAlpha` from `0.15` to `0.08` (line 150)
- Reduce xray `edgeAlpha` from `0.3` to `0.15` (line 151)
- Also update the legend select handler in `RoomVisualizationPanel.tsx` (line 737-739) to match

### `src/components/viewer/RoomVisualizationPanel.tsx`
- Update legend xray material settings to match the dimmer values

