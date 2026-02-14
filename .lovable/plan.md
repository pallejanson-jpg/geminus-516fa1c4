

## Vertical Color Scale Legend Bar with Interactive Selection

### Overview
Add a vertical color scale bar (inspired by the weather map temperature bar in the reference image) that appears on the left side of the 3D viewer when room visualization is active. Each value label on the bar is clickable -- clicking selects/highlights all rooms in the model that have that value.

### Design

The bar will be a tall, narrow vertical gradient strip with value labels at each color stop. It mimics the style of the floating floor switcher (semi-transparent, dark background, positioned along the left edge of the viewer). It will be visible only when a visualization type is active (temperature, CO2, humidity, occupancy, area).

```text
 +--------+
 | 30  °C |  <- red
 |        |
 | 26     |
 |        |  <- gradient
 | 22     |
 |        |
 | 20     |  <- green
 |        |
 | 18     |
 |        |  <- blue
 | 16     |
 +--------+
```

Each labeled row is clickable. Clicking "20" (green) selects all rooms with temperature around 20 degrees in the 3D model.

### Changes

**1. New component: `src/components/viewer/VisualizationLegendBar.tsx`**

- Renders a vertical bar with the gradient from the active visualization config
- Displays value labels at each color stop position
- Clickable labels: on click, finds all rooms whose value falls within the range of that stop and selects them in the 3D viewer (using `scene.setObjectsSelected`)
- Positioned fixed on the left side of the viewer, vertically centered
- Semi-transparent frosted glass style matching existing panels
- Shows the unit label at the top (e.g., "°C", "ppm", "%", "m2")
- Props: `viewerRef`, `visualizationType`, `rooms` (room data with sensor values), `useMockData`, `onRoomSelect` callback

**2. Modify: `src/components/viewer/RoomVisualizationPanel.tsx`**

- Export the current `rooms`, `visualizationType`, `useMockData` state so the legend bar can access them
- Alternatively, render the `VisualizationLegendBar` directly inside this component (simpler approach)
- Add a custom event (`VISUALIZATION_LEGEND_SELECT`) that the legend bar dispatches when a value is clicked
- On receiving the event, iterate rooms, find those matching the clicked value range, and call `scene.setObjectsSelected(ids, true)` on their entity IDs

**3. Selection logic (inside VisualizationLegendBar or RoomVisualizationPanel)**

When a color stop value is clicked:
1. Determine the value range: halfway between the previous stop and next stop
2. Filter rooms whose sensor value falls within that range
3. Deselect all previously selected objects: `scene.setObjectsSelected(scene.selectedObjectIds, false)`
4. Select matching room entities: for each matching room, get entity IDs from cache and call `scene.setObjectsSelected(ids, true)`
5. Optionally flash/highlight to give visual feedback

### Technical Details

- The vertical gradient uses CSS `linear-gradient(to top, ...)` (bottom = min, top = max) matching the weather bar orientation
- Color stops are taken directly from `VISUALIZATION_CONFIGS` in `visualization-utils.ts`
- Room value lookup reuses existing `extractSensorValue` / `generateMockSensorData` functions
- Entity ID resolution reuses the existing `entityIdCache` and `getItemIdsByFmGuid` from RoomVisualizationPanel
- The bar is rendered as a sibling to the IoTHoverLabel, inside RoomVisualizationPanel, so it has access to all needed state
- On mobile, the bar is slightly smaller and positioned to avoid overlap with floor pills
