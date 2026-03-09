

## Plan: Viewer Improvements — 10 Issues

This plan addresses all issues raised in priority order.

---

### 1. Split 2D/3D: Auto-center 2D plan on load

**Problem**: When opening split 2D/3D, the plan image is not centered — user must manually drag it into view.

**Fix in `SplitPlanView.tsx`**: The `initialCenterApplied` ref is set, but the auto-fit logic in `useEffect` (line 496) depends on `img.naturalWidth` being ready. The issue is timing — the image hasn't loaded when the effect runs.

**Change**: Add an `onLoad` handler on the `<img>` element that triggers the centering logic, ensuring dimensions are available. Move the centering code into a function called both from the effect and from `img.onLoad`.

---

### 2. Split 2D/3D: Show ALL objects in 3D pane

**Problem**: When entering split2d3d mode, the 3D side has objects filtered/hidden from previous state.

**Fix in `UnifiedViewer.tsx`**: When entering `split2d3d` mode, dispatch a "show all floors" event (`isAllFloorsVisible: true`) to reset any floor isolation in the 3D pane. Ensure `NativeViewerShell` doesn't inherit stale filter state.

---

### 3. Camera position icon bigger on desktop

**Problem**: The camera dot and FOV cone in `SplitPlanView` are too small on desktop.

**Fix in `SplitPlanView.tsx`** (lines 1061-1074): Increase the camera dot from `w-2.5 h-2.5` to `w-4 h-4` and the FOV cone border sizes from `12px/22px` to `16px/30px` on desktop. Use the existing `isMobile` check to conditionally size.

---

### 4. Filter panel resets to raw XKT colors instead of architect theme

**Problem**: Opening the filter panel calls `applyFilterVisibility` which does a clean slate reset, then calls `recolorArchitectObjects()` — but when no filters are active and the function returns early (line 805-822), the architect colors should already be applied. The issue is that the clean-slate reset (line 729-743) resets opacity and colorize for ALL objects, which undoes architect theme. Then `recolorArchitectObjects` is called but may not cover all entities.

**Fix in `ViewerFilterPanel.tsx`**: After `recolorArchitectObjects(viewer)` on line 747, also re-hide IfcSpace entities (already done on line 751-758). The real issue is that the batch `setObjectsColorized(prevColorized, false)` on line 734 removes ALL colorize — then `recolorArchitectObjects` needs to be the FULL `applyArchitectColors` call instead of just `recolorArchitectObjects`. Change line 747 to use the full `applyArchitectColors` import.

---

### 5. Properties dialog — use UniversalPropertiesDialog everywhere

**Problem**: The user says wrong properties dialog opens. Looking at `NativeViewerShell` line 697-703, it already uses `UniversalPropertiesDialog`. The issue is it only opens when `propertiesEntity` is set — which happens on select click (line 350) or context menu "Properties" (line 498-504). This is actually already correct. The confusion may be that the select click auto-opens it (issue #7 below).

**No change needed** — the dialog is already `UniversalPropertiesDialog`.

---

### 6. Select tool should be OFF by default

**Problem**: `activeToolRef` defaults to `'select'` (line 299), and `ViewerToolbar` also defaults to `'select'` (line 135).

**Fix**: Change both defaults to `null`. Clicking Select toggles it on/off. When Select is off, clicks don't trigger selection behavior.

---

### 7. Select tool should NOT auto-open properties dialog

**Problem**: When select tool is active and user clicks an object, `handleSelectClick` (line 314-351) opens `setPropertiesEntity` immediately. User wants properties only via right-click → Properties.

**Fix in `NativeViewerShell.tsx`**: Remove `setPropertiesEntity(...)` from `handleSelectClick`. Selection should highlight the object (`.selected = true`) but NOT open the properties panel. Properties only opens via `handleContextProperties`.

---

### 8. Measure and Section tools don't work

**Problem**: The toolbar dispatches `VIEWER_TOOL_CHANGED_EVENT` but there's no actual xeokit plugin instantiation for `DistanceMeasurementsPlugin` or `SectionPlanesPlugin`. The tools are just state toggles with no implementation.

**Fix in `ViewerToolbar.tsx`**: 
- **Measure**: When `activeTool === 'measure'`, instantiate `sdk.DistanceMeasurementsPlugin` (from the cached `window.__xeokitSdk`) and set it to `control.activate()`. On deactivate, call `control.deactivate()`.
- **Section**: When `activeTool === 'slicer'`, instantiate `sdk.SectionPlanesPlugin` with interactive UI. On deactivate, destroy/deactivate.

Both plugins are available in the xeokit SDK already loaded.

---

### 9. Enable "pivot around pointer" (followPointer) as default in orbit mode

**Problem**: In xeokit, `cameraControl.followPointer = true` makes orbiting pivot around the point under the cursor. Currently it's only enabled for firstPerson mode.

**Fix in `NativeXeokitViewer.tsx`** (after line 163): Set `cc.followPointer = true` as default for orbit mode.  
**Fix in `ViewerToolbar.tsx`** (line 460): Keep `followPointer = true` when switching to orbit mode instead of setting it to `false`.

---

### 10. Floor isolation should clip objects that extend above next floor

**Problem**: When isolating a floor, objects that belong to that floor but extend vertically past the next floor's start height are fully visible (e.g., a tall slab). The user wants a ceiling section plane at the next floor's start height.

**Current state**: `ViewerToolbar.tsx` line 239-243 explicitly removes 3D clipping when a floor is selected in 3D mode. The comment says "Floor isolation is handled purely via object visibility."

**Fix in `ViewerToolbar.tsx`**: When a solo floor is selected in 3D mode, apply ceiling clipping at the next floor's `minY` using `applyCeilingClipping(floorId)` instead of removing it. This clips geometry that extends past the floor boundary. The `applyCeilingClipping` function already calculates the correct height from `calculateClipHeightFromFloorBoundary`.

Change lines 239-243 from:
```
// In 3D mode: do NOT apply ceiling clipping
requestAnimationFrame(() => { try { remove3DClipping(); } catch {} });
```
To:
```
if (soloId) {
  applyCeilingClipping(soloId);
} else {
  requestAnimationFrame(() => { try { remove3DClipping(); } catch {} });
}
```

---

### 11. Slab selection highlights wrong geometry height

**Problem**: Clicking an IfcSlab selects and highlights the entire entity, but visually the highlight extends too high because the slab geometry in the BIM model includes more than the thin floor plate. This is a BIM data issue — the slab entity's mesh extends higher than expected. 

**Note**: This is not fixable in code — it's how the geometry is authored in the IFC file. The ceiling clipping fix (issue #10) will mitigate this by cutting off the visible extent.

---

### Files to modify

| File | Changes |
|------|---------|
| `src/components/viewer/SplitPlanView.tsx` | Auto-center on img load; bigger camera icon |
| `src/pages/UnifiedViewer.tsx` | Reset floor isolation when entering split2d3d |
| `src/components/viewer/ViewerFilterPanel.tsx` | Use `applyArchitectColors` instead of `recolorArchitectObjects` |
| `src/components/viewer/NativeViewerShell.tsx` | Select tool off by default; remove auto-open properties on select; default `activeToolRef` to `null` |
| `src/components/viewer/ViewerToolbar.tsx` | Select tool off by default; enable measure/section plugins; apply ceiling clipping in 3D floor selection; keep `followPointer = true` in orbit |
| `src/components/viewer/NativeXeokitViewer.tsx` | Set `followPointer = true` as default |

