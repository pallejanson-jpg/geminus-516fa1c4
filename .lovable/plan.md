
# Plan: Restore X-Ray, Room Sensor Coloring, and Left-Side Scale in the Native Viewer

## Summary

I will fix the native viewer’s right-side visualization flow so it behaves the way you described:

- X-Ray works again
- spaces are automatically shown when sensor visualization is active
- only the rooms currently visible in the viewer are colorized
- rooms are colored from real sensor properties such as temperature and CO₂
- the left-side scale/legend is shown again

## Root causes found

1. **X-Ray is effectively broken**
   - `XrayToggle.tsx` skips any object that already has a `colorize` value.
   - In this project, architect colors already colorize almost all objects, so X-Ray skips nearly the whole model.

2. **Room visualization is using incomplete room filtering**
   - `RoomVisualizationPanel.tsx` currently builds rooms mostly from `allData` + selected floor GUIDs.
   - It does **not reliably limit coloring to what is actually visible in the viewer scene**.
   - It also filters only `category === 'Space'`, while other parts of the app support both `Space` and `IfcSpace`.

3. **Space visibility is handled in two places**
   - `NativeViewerShell.tsx` has floor-aware `onShowSpacesChanged`.
   - `NativeXeokitViewer.tsx` also listens to `FORCE_SHOW_SPACES_EVENT`, but its handler currently shows **all** spaces, ignoring active floor selection.
   - This can override the intended “only visible level(s)” behavior.

4. **The legend overlay is missing in the native viewer**
   - `VisualizationLegendOverlay.tsx` exists and listens to `VISUALIZATION_STATE_CHANGED`.
   - But in the native viewer flow, it is not mounted in `NativeViewerShell.tsx`.
   - That is why the left-side scale indicator is missing even though the visualization panel dispatches the event.

## Changes

### 1. Fix X-Ray behavior
**File:** `src/components/viewer/XrayToggle.tsx`

- Change the X-Ray logic so it does **not** treat all colorized objects as “protected”.
- Only keep the actively highlighted sensor spaces exempt from ghosting, not the entire architect-colored model.
- Make X-Ray compatible with the current architectural palette and room visualization colors.

Result:
- X-Ray will ghost the building correctly again.
- Sensor-colored spaces will still remain readable when visualization is active.

---

### 2. Make room visualization use the spaces that are actually visible
**File:** `src/components/viewer/RoomVisualizationPanel.tsx`

- Expand room source filtering to support both `Space` and `IfcSpace`.
- Build the effective visualization target list from:
  - building rooms in `allData`
  - current floor selection
  - actual matching `IfcSpace` entities in the viewer
  - actual entity visibility in the scene
- Only colorize spaces that are currently visible in the viewer.

Result:
- “All floors” colors all visible spaces.
- “Selected level” colors only spaces on that level.
- Hidden floors/rooms are not included.

---

### 3. Unify “show spaces” so floor filtering is respected
**Files:**
- `src/components/viewer/NativeViewerShell.tsx`
- `src/components/viewer/NativeXeokitViewer.tsx`

- Align the `FORCE_SHOW_SPACES_EVENT` handling with the current visible-floor state.
- Ensure automatic “show spaces” for visualization respects selected floors instead of forcing every `IfcSpace` visible.
- Keep the existing explicit user-off guard, but allow visualization mode to intentionally enable spaces when chosen from the right menu.

Result:
- Sensor visualization turns spaces on as expected.
- But only the relevant visible rooms are shown and colored.

---

### 4. Restore the left-side visualization scale/legend
**File:** `src/components/viewer/NativeViewerShell.tsx`

- Mount `VisualizationLegendOverlay` in the native viewer shell, the same way the older viewer flow already supports it.
- Keep it independent from the right menu so it updates whenever visualization state changes.

Result:
- The vertical legend/scale appears again on the left.
- It reflects the active metric and current room values.

---

### 5. Keep the right-menu flow aligned with your intended behavior
**Files:**
- `src/components/viewer/VisualizationToolbar.tsx`
- `src/components/viewer/RoomVisualizationPanel.tsx`

- Keep the right-menu “Color filter” behavior tied to room sensor visualization, not generic object coloring.
- Ensure selecting a metric:
  - shows spaces
  - applies room coloring
  - updates the legend
- Ensure selecting “None” clears colors cleanly without leaving stale room states behind.

Result:
- The right menu behaves like the earlier working sensor-based room visualization flow.

## Files to modify

- `src/components/viewer/XrayToggle.tsx`
- `src/components/viewer/RoomVisualizationPanel.tsx`
- `src/components/viewer/NativeViewerShell.tsx`
- `src/components/viewer/NativeXeokitViewer.tsx`
- `src/components/viewer/VisualizationToolbar.tsx`

## Technical notes

```text
Visualization flow after fix:

Right menu metric selected
  → force spaces on
  → resolve current visible floors
  → collect matching visible IfcSpace entities
  → map them to room data from allData
  → read sensor properties (temperature / CO₂ / humidity / etc.)
  → color only visible rooms
  → publish VISUALIZATION_STATE_CHANGED
  → left legend overlay updates
```

```text
X-Ray after fix:

X-Ray ON
  → ghost normal building objects
  → preserve active sensor-colored spaces as readable
  → do not skip everything just because architect colors are applied
```

## No backend changes needed

This is a viewer/UI logic fix only. No database or authentication changes are needed.
