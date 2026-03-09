

# Fix Plan: Viewer Toolbar, Context Menu, Right Panel, Floor Switcher, 2D Quality, Crash, and Inventory

## Issues Identified

1. **Select tool does nothing on click** — The toolbar dispatches `VIEWER_TOOL_CHANGED_EVENT` but nothing in NativeViewerShell or NativeXeokitViewer listens for it and wires up click-to-select on the canvas.

2. **Context menu and other UI still in Swedish** — `ViewerContextMenu` labels are Swedish. `ViewerToolbar` has "Återställ vy". `Inventory.tsx` has Swedish text throughout. `ViewerRightPanel` has Swedish text ("Visning", "Lossa panelen", "Fäst panelen", "Stäng").

3. **2D plan low quality lines** — The StoreyViewsPlugin generates the plan image at a fixed resolution. Need to increase the `resolution` parameter for sharper rendering.

4. **Right panel (VisualizationToolbar) is transparent and buttons don't work** — The panel content (header + scroll area) is rendered without a wrapping container `div` with background styling. The `TooltipProvider` wraps the content but provides no layout or background. The panel is floating with no bg class.

5. **Floor switcher pills have inconsistent sizing** — Each pill has `min-w-[32px] max-w-[90px]` so width varies with text. Need uniform width.

6. **2D plan not auto-centered on start** — The initial `panZoom` state is `{ offsetX: 0, offsetY: 0, scale: 0.75 }` which places the image at top-left. The centering effect fires after the image loads, but if the image dimensions aren't ready yet, the user sees the raw offset.

7. **Crash: `Cannot read properties of null (reading 'ox')`** — At line 838 in SplitPlanView, `panZoom` is read in a `useCallback` with `[panZoom]` dependency. The error occurs during React render when `panStartRef.current` is accessed — but the actual crash is from the `handleMouseDown` closure reading stale `panZoom`. The crash trace shows it happening during `useState` which suggests a state update during render. Need to use a ref for panZoom in the callbacks.

8. **Inventory page 3D viewer doesn't start + Swedish text** — The `Inline3dPositionPicker` renders `NativeXeokitViewer` which should work. Need to check if the component is properly receiving the `buildingFmGuid`. Also translate all Swedish text to English.

---

## Changes

### 1. Wire Select tool click handler (`NativeViewerShell.tsx`)
- Listen for `VIEWER_TOOL_CHANGED_EVENT` to track active tool.
- When active tool is `'select'`, add a `click` event listener on the canvas that picks the clicked entity and sets it as selected (deselecting others first).
- Show properties dialog automatically when an object is selected via the Select tool.

### 2. Translate all Swedish to English
- **`ViewerContextMenu.tsx`**: Egenskaper→Properties, Markera→Select, Zooma till→Zoom to, Isolera→Isolate, Dölj→Hide, Flytta objekt→Move object, Ta bort objekt→Delete object, Visa alla→Show all, Visa etiketter→Show labels, Visa rumsetiketter→Show room labels, Skapa ärende→Create issue, Visa ärenden→Show issues.
- **`ViewerToolbar.tsx`**: "Återställ vy"→"Reset view".
- **`Inventory.tsx`**: All Swedish text to English (Inventering→Inventory, Senast registrerade→Recently registered, Redigera tillgång→Edit asset, Registrera ny tillgång→Register new asset, AI Skanning→AI Scan, 3D-vy/360°-vy→3D View / 360° View, the placeholder text).
- **`ViewerRightPanel.tsx`**: "Visning"→"Display", "Lossa panelen"/"Fäst panelen"→"Unpin panel"/"Pin panel", "Stäng"→"Close", any remaining Swedish toast text.

### 3. Fix 2D plan image quality (`SplitPlanView.tsx`)
- Pass higher `width` parameter to `plugin.createStoreyMap()` (e.g. 4000 instead of default ~2000) for sharper line rendering.

### 4. Fix VisualizationToolbar panel background (`VisualizationToolbar.tsx`)
- Wrap the header + scroll content in a `div` with `fixed right-0 top-0 h-full w-[288px] sm:w-[320px] z-[60] bg-card border-l border-border flex flex-col` so it has a solid background and proper layout.

### 5. Uniform floor switcher pill width (`FloatingFloorSwitcher.tsx`)
- Set a fixed `min-w-[60px]` and remove `max-w-[90px]` on desktop pills, and center text. This ensures all pills are the same size.

### 6. Fix 2D plan auto-center (`SplitPlanView.tsx`)
- Change initial `panZoom` to `{ offsetX: 0, offsetY: 0, scale: 1 }` with `initialCenterApplied` flag ensuring centering runs on first image load.
- Add an `onLoad` handler to the `<img>` that re-triggers centering if dimensions weren't available initially.

### 7. Fix crash — null `panZoom` in closure (`SplitPlanView.tsx`)
- Use a `panZoomRef` that always mirrors the latest `panZoom` state. In `handleMouseDown`, `handleTouchStart`, and `handleMouseMove`, read from `panZoomRef.current` instead of the stale closure value.

### 8. Fix Inventory 3D viewer and translate (`Inventory.tsx`)
- Translate all Swedish UI strings to English.
- The 3D viewer should already work via `Inline3dPositionPicker` → `NativeXeokitViewer`. If the issue is the button text being unclear, ensure "Select 3D position" is prominently labeled in English.

---

## Files to Edit

| File | Changes |
|------|---------|
| `src/components/viewer/NativeViewerShell.tsx` | Add select-tool click handler |
| `src/components/viewer/ViewerContextMenu.tsx` | Translate all labels to English |
| `src/components/viewer/ViewerToolbar.tsx` | Translate "Återställ vy" → "Reset view" |
| `src/components/viewer/VisualizationToolbar.tsx` | Add panel container with bg-card |
| `src/components/viewer/FloatingFloorSwitcher.tsx` | Uniform pill sizing |
| `src/components/viewer/SplitPlanView.tsx` | Higher resolution, auto-center fix, crash fix |
| `src/components/viewer/ViewerRightPanel.tsx` | Translate Swedish labels |
| `src/pages/Inventory.tsx` | Translate all Swedish to English |

