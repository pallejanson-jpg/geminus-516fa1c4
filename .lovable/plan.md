

## Plan: Mobile 3D Viewer Layout Optimization + Red Room Fix

### Problem 1: Mobile header too low, toolbar too high
The `MobileViewerOverlay` header uses `paddingTop: calc(max(env(safe-area-inset-top), 20px) + 8px)` — this adds extra padding pushing controls down. The `ViewerToolbar` bottom bar uses `bottom: calc(max(env(safe-area-inset-bottom), 12px) + 8px)` — not enough clearance but also not utilizing the space well.

### Problem 2: Red rooms on first load
IfcSpace objects are hidden at line 526 in `NativeXeokitViewer.tsx` — but they're hidden *without* first applying the blue color. When any code later makes them visible (filter panel, "Visa rum", "Show All"), they appear with raw red IFC materials until explicitly re-colored. The fix is to **pre-apply the blue color and opacity to all IfcSpace entities at load time**, before hiding them. This way, whenever they become visible later, they're already blue.

### Changes

**1. `src/components/viewer/mobile/MobileViewerOverlay.tsx`**
- Reduce the header's `paddingTop` to use just the safe-area-inset with minimal extra padding: `calc(env(safe-area-inset-top, 0px) + 4px)` and reduce `p-2` to `p-1.5`
- Make buttons smaller (`h-8 w-8`) and mode switcher more compact

**2. `src/components/viewer/ViewerToolbar.tsx`**
- On mobile, increase bottom offset to push the toolbar lower: `calc(env(safe-area-inset-bottom, 0px) + 4px)` — just enough to clear the browser chrome without going under it
- Reduce button sizes on mobile for more compact layout

**3. `src/components/viewer/NativeXeokitViewer.tsx`**
- At lines 518-532 where IfcSpace entities are hidden, **pre-colorize them blue** before hiding:
  ```
  entity.colorize = [0.5, 0.7, 0.9];
  entity.opacity = 0.3;
  entity.visible = false;
  entity.pickable = false;
  ```
- This ensures any subsequent `visible = true` shows blue, never red

**4. `src/components/viewer/NativeViewerShell.tsx`**
- In `handleContextShowAll` (line 321-335), after re-hiding IfcSpaces, also pre-apply blue color so they stay blue if toggled on later

