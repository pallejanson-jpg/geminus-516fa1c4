

## Plan: Fix 5 Outstanding 3D Viewer Issues

### Issue 1: Rooms (IfcSpace) are red and visible by default
The neutral grey colorize (`[0.85, 0.85, 0.85]`) applied in `NativeXeokitViewer.tsx` (line 498) colors ALL objects including IfcSpace. The native viewer has no logic to hide IfcSpace objects after load — unlike the AssetPlusViewer which tracks and hides them.

**Fix**: After the neutral colorize loop, iterate `metaScene.metaObjects`, find all `ifcspace` type objects, and hide them (`entity.visible = false`). They remain hidden until the visualization/filter panel explicitly enables them. Remove the blanket neutral colorize — instead only colorize objects that have strong red IFC materials (the original problem), leaving other objects with their native colors.

Actually, the real issue is simpler: the blanket neutral grey is overriding all native colors. The A-model for Akerselva Atrium never had red objects before the native viewer — the reds appeared because `setObjectsColorized(allIds, false)` was resetting colorize state to raw IFC materials. The correct fix:
- **Remove the blanket neutral colorize entirely** (lines 490-506)
- **Don't call `setObjectsColorized(allIds, false)` either** — just leave objects with whatever colors xeokit loads from XKT
- **Hide IfcSpace objects by default** after load, since rooms should be off by default

### Issue 2: Left sidebar should be accessible via hamburger in 3D mode
Currently `hideDesktopSidebar` completely removes the sidebar in viewer apps. Instead, the sidebar should be collapsed by default when entering a viewer app, with the hamburger button still accessible to expand/collapse it.

**Fix in `AppLayout.tsx`**: Remove the `hideDesktopSidebar` condition that hides `LeftSidebar`. Instead, auto-collapse the sidebar when `activeApp` is a viewer app by calling `setIsSidebarExpanded(false)` via a `useEffect`. The hamburger in `LeftSidebar` remains visible (the sidebar is always 14-16px wide when collapsed showing just icons).

### Issue 3: Filter icon overlaps ViewerToolbar icon
The filter toggle button is at `top-3 right-3`. It overlaps with other controls.

**Fix in `NativeViewerShell.tsx`**: Move the filter button to `top-3 left-3` (upper left corner) instead.

### Issue 4: NavCube still shows colored faces
Looking at the NavCubePlugin.js code, the colors defined at lines 239-246 ARE neutral greys (`#b0b5bc`, `#888d94`, etc.). If the user still sees red/green/purple, it means the file wasn't actually deployed or the browser cached the old version. However, to be safe, I'll verify the colors are truly neutral and add a cache-busting mechanism.

**Fix**: The colors in the code look correct. The issue is likely that `NavCubePlugin.js` is in `/public/lib/xeokit/` and may be browser-cached. Ensure the colors are definitively neutral by using even more obviously grey values, and reference the file with a version query param in the HTML or loader.

### Issue 5: Floor switcher should clip objects protruding above
The `applyCeilingClipping` in `useSectionPlaneClipping` already creates a section plane at the next floor's minY to clip above. The `ViewerToolbar` listens for `FLOOR_SELECTION_CHANGED_EVENT` and calls `applyCeilingClipping(soloId)` when a solo floor is selected. This should already work.

**Verify**: Check that the `FloatingFloorSwitcher` dispatches `isSoloFloor` correctly and that `ViewerToolbar` receives and processes it. The floor switcher does dispatch the event with `isAllFloorsVisible` and the toolbar checks `!isAllFloorsVisible && visibleMetaFloorIds?.length === 1`. This logic looks correct — the clipping should already work if the section plane creation succeeds.

---

### Files to change:
1. **`src/components/viewer/NativeXeokitViewer.tsx`** — Remove blanket neutral colorize. Add IfcSpace hiding after model load.
2. **`src/components/layout/AppLayout.tsx`** — Replace sidebar hiding with auto-collapse via `useEffect` + `setIsSidebarExpanded(false)`.
3. **`src/components/viewer/NativeViewerShell.tsx`** — Move filter button from `top-3 right-3` to `top-3 left-3`.
4. **`public/lib/xeokit/NavCubePlugin.js`** — Verify/reinforce neutral grey palette. The current code already has greys — may need cache clearing or the file wasn't saved properly last time.

