

## Plan: Comprehensive 3D Viewer Fix — 15 Issues

This is a large refactoring effort covering many interconnected issues. I'll organize by priority and group related fixes.

---

### Issue Analysis

**Current architecture**: `MainContent` routes `native_viewer` → `NativeViewerPage` → `NativeViewerShell` → `NativeXeokitViewer` (canvas) + overlays. The `UnifiedViewer` (with mode switcher 2D/3D/Split/360) exists but is NOT mounted — it was bypassed when standardizing on native xeokit. The VisualizationToolbar (right panel / "Visning") is a floating draggable panel, not a fixed sidebar.

---

### Task 1: Fix red room objects (IfcSpace first-load color)

**Problem**: IfcSpace objects are initially hidden (`visible=false, pickable=false` at line 526 in NativeXeokitViewer). But the `applyFilterVisibility` in ViewerFilterPanel does `scene.setObjectsVisible(scene.objectIds, true)` as "clean slate" (line 655), which makes all IfcSpaces visible again — with their raw IFC material color (often red). When the user then toggles "Visa rum" off, the shim sets them to the correct blue color. So first filter interaction reveals red rooms.

**Fix**: In `ViewerFilterPanel.applyFilterVisibility`, after the "clean slate" reset, immediately re-hide all IfcSpace objects (same as the no-filter branch at line 724-731 already does, but this needs to happen for ALL filter scenarios, not just "no filter"). The existing code at lines 724-731 only runs when `!hasAnyFilter`. Move the IfcSpace hiding to happen unconditionally after every clean slate reset.

**Files**: `src/components/viewer/ViewerFilterPanel.tsx`

---

### Task 2: Fix ceiling clipping (objects sticking up above floors)

**Problem**: The `applyCeilingClipping` in `useSectionPlaneClipping` creates a section plane, but it may not be correctly positioned or the section plane creation might fail silently. The ViewerToolbar listens for `FLOOR_SELECTION_CHANGED_EVENT` and calls `applyCeilingClipping(soloId)` when a single floor is selected.

**Fix**: Verify the section plane creation in `useSectionPlaneClipping`. The `createSectionPlane` function tries multiple strategies. The issue is likely that when using the native xeokit viewer, the section plane needs to be created with the correct API. Add logging and ensure `applyCeilingClipping` actually positions the plane at the correct height (next floor's minY or current floor's maxY).

**Files**: `src/hooks/useSectionPlaneClipping.ts`, `src/components/viewer/ViewerToolbar.tsx`

---

### Task 3: Convert VisualizationToolbar to fixed right sidebar

**Problem**: Currently a floating draggable panel. User wants it as a fixed panel on the right side (like the filter panel on the left), scrollable.

**Fix**: Change VisualizationToolbar rendering from a floating positioned `div` to a fixed right-side panel (`fixed top-0 right-0 h-full w-80`) with `ScrollArea` for content. Remove drag logic. Add a toggle button (like the filter toggle on the left) to show/hide it. Keep all existing functionality.

**Files**: `src/components/viewer/VisualizationToolbar.tsx`, `src/components/viewer/NativeViewerShell.tsx`

---

### Task 4: Restore desktop mode switcher (2D/3D/Split/360)

**Problem**: The `UnifiedViewer` has the mode switcher (2D, 3D, Split 2D&3D, 3D/360, VT, 360°) in its header bar. But `NativeViewerPage`/`NativeViewerShell` doesn't have this — it only has a 2D/3D toggle in the bottom toolbar. The user expects the full mode switcher on desktop.

**Fix**: Add a compact mode switcher bar in `NativeViewerShell` (or route through `UnifiedViewer` instead of `NativeViewerPage`). The simplest approach: update `MainContent` to route `native_viewer` through `UnifiedViewer` which already has the mode switcher and delegates 3D rendering to `NativeViewerShell`.

**Files**: `src/components/layout/MainContent.tsx`, possibly `src/pages/UnifiedViewer.tsx`

---

### Task 5: Left sidebar behavior in 3D

**Problem**: The sidebar auto-collapses but the collapsed state still shows icons (14-16px wide), which can overlap viewer content. User wants it hidden by default in 3D but expandable via hamburger, and when expanded the 3D canvas should shrink to make room.

**Fix**: When a viewer app is active on desktop, use CSS `translate-x` to fully hide the sidebar (like on mobile), but keep the hamburger button visible. When expanded, the sidebar should push the main content rather than overlay it. This is already partially implemented — the collapsed sidebar shows icons. The real fix: in `AppLayout`, for immersive apps on desktop, keep the layout structure but auto-collapse. The sidebar's collapsed state (`md:w-14`) already shrinks. The floor switcher at `left-3` should clear a 56px (14*4) collapsed sidebar.

Actually, re-reading: "Huvudsidans vänstermeny skall vara dold som standard i 3D men kunna tändas med hamburgaren." The sidebar should be fully hidden (not just collapsed to icons), but the hamburger toggle should remain visible. When toggled on, the 3D canvas should resize.

**Fix**: Add a `hideDesktopSidebar` state that fully hides the sidebar (`-translate-x-full`) on desktop in viewer apps, but keeps a floating hamburger button visible at top-left. When toggled, the sidebar slides in and the flex layout adjusts the viewer width.

**Files**: `src/components/layout/AppLayout.tsx`, `src/components/layout/LeftSidebar.tsx`

---

### Task 6: Remove debug badges

**Problem**: "Native xeokit" badge at top-left (line 682-686 in NativeXeokitViewer) and "Native xeokit viewer (prototype)" text during loading (line 665-668).

**Fix**: Remove both elements.

**Files**: `src/components/viewer/NativeXeokitViewer.tsx`

---

### Task 7: Fix FastNav settings default

**Problem**: `getFastNavEnabled()` defaults to `true` (line 60 in VoiceSettings.tsx). User wants it off by default.

**Fix**: Change default return from `true` to `false`.

**Files**: `src/components/settings/VoiceSettings.tsx`

---

### Task 8: Fix BIM model names in VisualizationToolbar

**Problem**: The VisualizationToolbar's `ModelVisibilitySelector` may show GUID names instead of resolved names. The FilterPanel already uses `useModelData` which resolves names correctly.

**Fix**: Verify `ModelVisibilitySelector` uses the same `useModelData` hook. If it does, the issue may be timing — the names resolve asynchronously. Check and fix.

**Files**: `src/components/viewer/ModelVisibilitySelector.tsx`

---

### Task 9: Fix floors in VisualizationToolbar

**Problem**: `FloorVisibilitySelector` in the VisualizationToolbar doesn't work.

**Fix**: The `FloorVisibilitySelector` uses `useFloorData` which depends on `viewerRef` to access the xeokit viewer. The shim ref chain (`viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer`) may not resolve correctly. Verify the ref chain works.

**Files**: `src/components/viewer/FloorVisibilitySelector.tsx`

---

### Task 10: Fix Room Labels and Annotations in VisualizationToolbar

**Problem**: Room labels toggle dispatches `ROOM_LABELS_TOGGLE_EVENT` but the `useRoomLabels` hook needs a valid viewer reference. Annotations toggle dispatches `TOGGLE_ANNOTATIONS` but nothing listens for it in the native viewer context.

**Fix**: Ensure the `useRoomLabels` hook is instantiated in `NativeViewerShell` with the correct viewer ref. Wire up annotation toggle to actually show/hide annotation markers.

**Files**: `src/components/viewer/NativeViewerShell.tsx`

---

### Task 11: Fix context menu — only Show Labels, Create Issues, View Issues, Show Room Labels

**Problem**: Current menu has Properties, Select, Zoom to fit, Isolate, Hide, Show all. User wants: Show Labels, Create Issues, View Issues, Show Room Labels.

**Fix**: Replace current menu items with the requested four actions: Show Labels (toggle room labels), Create Issues (open issue dialog), View Issues (open issue list), Show Room Labels (toggle room label visibility).

**Files**: `src/components/viewer/ViewerContextMenu.tsx`, `src/components/viewer/NativeViewerShell.tsx`

---

### Task 12: Rewrite bottom navigation toolbar as configurable

**Problem**: Current toolbar has hardcoded buttons. User wants max 10 configurable tools with a settings cog at the right end to add/remove tools.

**Default tools**: Orbit, First Person, Fit View, Select, Measure, Section, 2D/3D.
**Configurable extras**: X-ray, On Hover, and other xeokit features.

**Fix**: Rewrite `ViewerToolbar` with a configurable tool system. Store active tools in localStorage. Add a settings button that opens a popover with all available tools as toggleable switches. Keep the existing xeokit API integrations (navMode, zoom, measure, section planes).

**Files**: `src/components/viewer/ViewerToolbar.tsx`

---

### Task 13: Fix Filter Panel — source selection, levels, spaces, colorization

**Problem**: Selecting A-model in Småviken hides everything. Levels show incorrectly. No spaces shown. Colorization broken.

**Root cause**: The `buildEntityMap` function builds a mapping from fmGuid to xeokit entity IDs. When selecting a source, it collects entity IDs from levels belonging to that source — but if no levels match (because the entity map failed to build), everything gets hidden. Also, `applyFilterVisibility` uses `sourceIds` intersection which may produce an empty set.

**Fix**: Debug the entity map building for Småviken. The fallback logic at line 360-364 treats all scene models as A-models if `sharedModels` hasn't resolved names — this means all storeys should be eligible. The issue is likely in the `source::` key mapping (line 496-527) which tries to match model objects to sources. If the model has no IfcBuildingStorey in its first-level objects, the source mapping fails.

For levels: ensure `useFloorData` returns correctly named floors (it already has database name resolution).

For spaces: the spaces list at line 194-210 filters by `checkedLevels` or all levels — but requires `buildingData` to have Space assets. This depends on `allData` from `AppContext` which comes from Asset+.

**Files**: `src/components/viewer/ViewerFilterPanel.tsx`

---

### Task 14: Fix Insights 3D launch

**Problem**: Insights should start Native XEO with correct criteria. Toolbars should scale correctly and color mapping should work.

**Fix**: Verify that `BuildingInsightsView` dispatches `INSIGHTS_COLOR_UPDATE_EVENT` correctly and that `NativeXeokitViewer` handles it (it already has a listener at line 581-639). The issue may be that insights launches a different viewer path.

**Files**: `src/components/insights/BuildingInsightsView.tsx`

---

### Task 15: NavCube colors

**Problem**: User still sees colored NavCube. The code in `NavCubePlugin.js` has neutral greys — likely browser cache issue, or the custom plugin isn't loading and the SDK fallback is used.

**Fix**: Add a more aggressive cache bust (`?v=${Date.now()}`), and ensure the custom plugin actually overrides the SDK default. Also check if the SDK `NavCubePlugin` (line 108-110 fallback) is being used instead.

**Files**: `src/components/viewer/NativeXeokitViewer.tsx`, `public/lib/xeokit/NavCubePlugin.js`

---

### Implementation Order (by dependency)

1. **Task 6**: Remove debug badges (quick win)
2. **Task 7**: Fix FastNav default (quick win)
3. **Task 1**: Fix red room objects
4. **Task 2**: Fix ceiling clipping
5. **Task 5**: Left sidebar behavior
6. **Task 3**: VisualizationToolbar → fixed right panel
7. **Task 12**: Rewrite bottom toolbar (configurable)
8. **Task 11**: Context menu changes
9. **Task 4**: Restore mode switcher
10. **Task 8-10**: Fix BIM names, floors, labels, annotations
11. **Task 13**: Fix filter panel
12. **Task 14**: Fix Insights 3D
13. **Task 15**: NavCube cache

This is a multi-session effort. I recommend implementing in 2-3 batches to allow testing between rounds.

