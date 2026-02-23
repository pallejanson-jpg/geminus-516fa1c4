

## Fix: Hide Obstructing Objects + Make X-ray Opt-in

### Problem 1: Green IfcSpace objects blocking the view
When selecting a floor in the filter panel, all objects on that floor become "solid" -- including IfcSpace entities. These render as large opaque green surfaces that block the view of the actual building geometry (see screenshot). The ViewerToolbar's 2D mode already solves this by making IfcSpace near-transparent and IfcSlab invisible. The filter panel needs the same treatment.

**Fix**: After computing `solidIds`, exclude IfcSpace and IfcSlab entities from the solid set. IfcSpace gets hidden (`visible = false`), and IfcSlab gets made transparent (`opacity = 0, pickable = false`). This matches the established pattern in `ViewerToolbar.tsx` lines 454-461.

### Problem 2: X-ray kills performance
Currently, the filter panel **always** applies X-ray to all non-selected objects (Step 3, lines 513-528). For a model with 100k+ objects, xeokit must render each ghosted object with transparency blending, which dramatically slows orbit/pan/zoom -- especially when zoomed out and all floors are visible.

**Fix**: Change the default filter behavior from X-ray to **visibility hiding**. Non-selected objects are simply hidden (`visible = false`) instead of xrayed. This is much faster because xeokit doesn't need to render hidden objects at all.

### Problem 3: X-ray should be opt-in
Add an X-ray toggle to the filter panel header so users can switch from "hide" mode to "xray" mode when they want the transparent ghost context. The existing `XrayToggle` in the right panel (VisualizationToolbar) stays as-is.

### Technical Changes

**File: `src/components/viewer/ViewerFilterPanel.tsx`**

| Section | Change |
|---|---|
| State (top of component) | Add `xrayMode` state (`useState(false)`) controlling whether filters use X-ray or visibility hiding |
| Step 2 (solidIds computation, ~line 500) | After computing `solidIds`, remove IfcSpace and IfcSlab entity IDs from the set. Collect them separately as `excludeIds`. |
| Step 3 (X-ray application, lines 513-528) | Replace with conditional logic: if `xrayMode` is ON, apply X-ray as before; if OFF (default), use `scene.setObjectsVisible(nonSolidIds, false)` instead |
| IfcSpace/Slab handling (new, after Step 3) | Hide IfcSpace entities and make IfcSlab transparent+unpickable, matching the ViewerToolbar 2D approach |
| Step 0 (clean slate, lines 419-424) | Also reset visibility: `scene.setObjectsVisible(scene.objectIds, true)` (already there) -- ensure it also clears opacity/pickable for slabs |
| UI (filter panel header area) | Add an X-ray toggle button (Box icon) next to the existing controls, wired to `xrayMode` state |
| Dependencies of `applyFilterVisibility` | Add `xrayMode` to the dependency array |

The IFC types to exclude from solid rendering:
- `IfcSpace` -- hidden entirely (large floor surfaces)
- `IfcSlab`, `IfcSlabStandardCase` -- made transparent + unpickable (floor/ceiling slabs block clicks)

### No other files need changes
The existing XrayToggle in the right panel and ViewerToolbar remain unchanged -- they operate independently on the global scene. The filter panel's new behavior only affects what happens when filters are active.
