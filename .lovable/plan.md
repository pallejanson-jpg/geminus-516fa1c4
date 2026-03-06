

# Plan: Geminus Plugin Menu Access, FM Access Context Sync, Insights Fixes

## Questions Answered

### 1. How to Start the Geminus Plugin Menu
The `GeminusPluginMenu` is currently rendered automatically inside these views:
- **FM Access 2D Panel** (embedded mode) — appears as a FAB in bottom-right when the iframe is ready
- **FmAccessNativeView** does NOT render it
- **InsightsDrawerPanel** does NOT render it standalone

It is NOT a standalone page with its own URL today.

### 2. FM Access Embedded vs External Tab
- **Embedded (fma_plus):** The FAB appears automatically over the FM Access iframe via `FmAccess2DPanel`
- **External tab:** Currently no mechanism exists to inject the menu into an external browser tab

### 3. Own URL for Plugin Menu
Not currently. A standalone route (e.g. `/plugin?building=GUID`) could be created that renders only the `GeminusPluginMenu` with transparent background, for use as a companion popup or iframe overlay from other systems.

### 4. Context-Aware Listening from FM Access Iframe
The HDC web client changes its URL fragment/hash when navigating (building → floor → room). The `FmAccess2DPanel` iframe can be monitored via `postMessage` events or by polling the iframe URL. Tessel HDC also sends `HDC_APP_SYSTEM_READY` via `postMessage` — there may be additional navigation events we can listen for.

**Strategy:** Listen for `postMessage` from the HDC iframe for navigation events. If HDC doesn't emit them, poll the iframe's `contentWindow.location` (same-origin only) or use the HDC URL hash changes. Since the iframe is cross-origin (`landlord.bim.cloud`), polling won't work — we need `postMessage`. We should investigate what messages HDC sends.

## Implementation Plan

### Task 1: Investigate Tessel HDC postMessage API
Add a debug listener in `FmAccess2DPanel` that logs ALL `postMessage` events from the HDC iframe origin. This will reveal what navigation/click events HDC emits beyond `HDC_APP_SYSTEM_READY`. Document findings.

### Task 2: FM Access Context Bridge
In `FmAccess2DPanel`, add a `postMessage` listener that captures HDC navigation events (object selections, floor changes) and:
- Extracts GUID/objectId from the message payload
- Dispatches a new `FM_ACCESS_CONTEXT_CHANGED_EVENT` custom event with the GUID
- Updates `GeminusPluginMenu` props with the current context (building/floor/room GUID)
- This makes Gunnar, Ilean, and Insights context-aware to whatever is selected in FM Access

### Task 3: Standalone Plugin Route
Create `/plugin` route that renders `GeminusPluginMenu` full-screen with transparent/minimal chrome. Accepts query params: `?building=GUID&floor=GUID&room=GUID&source=external`. This gives other systems a URL to open as a companion window.

### Task 4: Fix Room Card Colors → 3D Mismatch (Insights Space Tab)
**Problem:** Room heatmap cards use `getVisualizationColor()` to compute sensor-based colors (temperature gradient), but the "View rooms in 3D" button sends these same colors correctly. The pie chart "Room Types" uses chart palette colors. When clicking pie segments, room fmGuids get the pie chart color — this should be correct.

**Investigation needed:** The room cards in the heatmap use hex colors derived from `getVisualizationColor`. When dispatching `INSIGHTS_COLOR_UPDATE_EVENT`, the `colorMap` maps `fmGuid → rgb`. The NativeXeokitViewer then tries to match by `originalSystemId` or name. If matching fails, rooms stay xrayed. Need to verify the matching logic handles the fmGuid-to-BIM-id mapping.

### Task 5: Reset 3D on Tab Change Without Full Reload
**Problem:** Switching tabs in Insights should reset the 3D colorization but currently either stays colored or reloads entirely.

**Solution:** Add a `useEffect` on `activeTab` that dispatches a "reset" event (a special `INSIGHTS_COLOR_UPDATE_EVENT` with empty colorMap or a new `INSIGHTS_COLOR_RESET_EVENT`). In `NativeXeokitViewer`, handle this by calling `scene.setObjectsXRayed(scene.objectIds, false)` and `applyArchitectColors()` — no model reload needed.

### Task 6: Alarm Annotations on FM/Alarms Tab
**Problem:** `ALARM_ANNOTATIONS_SHOW_EVENT` is dispatched but `NativeXeokitViewer` has no handler for it.

**Solution:** Add an event listener in `NativeXeokitViewer` for `ALARM_ANNOTATIONS_SHOW_EVENT`. For each alarm, find the matching entity by fmGuid/roomFmGuid in metaScene, fly-to the first match, and highlight/un-xray matching entities with a red color.

### Task 7: Rename FM Tab to "Alarms"
Simple label change: In `BuildingInsightsView.tsx`, change the TabsTrigger text from "FM" to "Alarms" and update the icon to `Bell`.

## File Changes Summary

| File | Change |
|------|--------|
| `src/components/viewer/FmAccess2DPanel.tsx` | Add postMessage debug listener + context bridge |
| `src/lib/viewer-events.ts` | Add `FM_ACCESS_CONTEXT_CHANGED_EVENT` |
| `src/components/viewer/GeminusPluginMenu.tsx` | Accept dynamic context updates |
| `src/App.tsx` | Add `/plugin` route |
| `src/pages/PluginPage.tsx` | New standalone plugin page |
| `src/components/insights/BuildingInsightsView.tsx` | Tab reset on change, rename FM→Alarms, fix color dispatch |
| `src/components/viewer/NativeXeokitViewer.tsx` | Handle color reset event, handle ALARM_ANNOTATIONS_SHOW_EVENT |

