

## Plan: Refactor 3D Viewer Controls for Native Xeokit

### Issues Identified

1. **Red objects in Akerselva Atrium A-model**: Line 494 in `NativeXeokitViewer.tsx` calls `scene.setObjectsColorized(allIds, false)` which resets colorize state but xeokit's internal defaults for some IFC objects may differ from what the old Asset+ viewer showed. The old viewer likely applied its own default material/color scheme. Need to investigate whether removing this reset, or applying a neutral default colorize, fixes the issue.

2. **Floor switcher overlaps sidebar on desktop**: The sidebar (`LeftSidebar`) is only hidden on mobile via `isImmersive = isMobile && IMMERSIVE_APPS`. On desktop, the sidebar (14-16 wide) stays visible, causing the `left-3` floor switcher to be hidden behind it. Fix: hide the left sidebar on desktop when `native_viewer` is active, or offset the switcher by the sidebar width.

3. **ViewerToolbar broken with native xeokit**: The toolbar relies on the Asset+ shim ref chain (`getAssetView()`, `assetView.useTool()`, etc.) which are stubs in the native shim. Measure, slicer, select tools don't actually work. Needs complete rewrite to talk directly to xeokit APIs.

4. **ViewerContextMenu**: Works reasonably well already (picks entities, zoom-to-fit, isolate, hide, show all). But "Create issue", "Create work order", "View in space" are no-ops. Should be cleaned up.

5. **NavCube colors**: Currently uses vivid blue palette. User wants neutral/clean appearance.

---

### Implementation Plan

#### Task 1: Fix red objects in A-model
- Remove `scene.setObjectsColorized(allIds, false)` on line 494 — this is likely forcing xeokit to use raw IFC material colors which include reds that Asset+ previously overrode with its own default scheme.
- Instead, after loading, apply a neutral default color `[0.85, 0.85, 0.85]` to all objects (mimicking the grey-ish default that BIM viewers typically show for architectural models), then let the filter panel and visualization tools override as needed.
- This ensures A-models look clean without baked-in IFC material colors showing through.

#### Task 2: Hide sidebar in 3D on desktop
- In `AppLayout.tsx`, change `isImmersive` logic from `isMobile && IMMERSIVE_APPS` to also hide sidebar on desktop when `activeApp` is a viewer app (native_viewer, radar, etc.).
- This gives the viewer full width and prevents the floor switcher from being hidden.
- Alternative: keep sidebar visible but offset floor switcher by sidebar width. Hiding is cleaner.

#### Task 3: Rewrite ViewerToolbar for native xeokit
- Delete the current `ViewerToolbar.tsx` (705 lines of Asset+-dependent code).
- Write a new clean toolbar that talks directly to the xeokit `Viewer` instance (passed via prop, not through shim ref chain).
- Core functions mapped directly:
  - **Orbit/FirstPerson**: `viewer.cameraControl.navMode`
  - **Zoom in/out**: camera eye manipulation (already working)
  - **View fit**: `viewer.cameraFlight.flyTo({ aabb })` using selected or scene AABB
  - **Select**: already default pick behavior in xeokit
  - **X-ray**: `scene.setObjectsXRayed()` (already working)
  - **2D/3D toggle**: camera projection + section plane clipping (keep existing `useSectionPlaneClipping` hook)
  - **Measure**: use xeokit `DistanceMeasurementsPlugin` directly
  - **Section plane**: use xeokit `SectionPlanesPlugin` directly
- Keep the bottom-center floating pill design.
- Pass `xeokitViewer` directly instead of `viewerShimRef`.

#### Task 4: Clean up ViewerContextMenu
- Remove unused actions (Create issue, Create work order, View in space) that are no-ops.
- Remove the configurable settings system (`ContextMenuSettings.ts`) — simplify to hardcoded actions that actually work.
- Keep: Properties, Select, Zoom to fit, Isolate, Hide, Show all.
- Pass `xeokitViewer` directly for cleaner integration.

#### Task 5: Fix NavCube appearance
- Replace the blue color palette in `NavCubePlugin.js` with a neutral/professional scheme:
  - Light grey faces with subtle shading variation per face
  - Clean white edges
  - Darker text labels
- This gives a clean, non-distracting appearance typical of professional BIM viewers.

#### Task 6: Update NativeViewerShell
- Update props to pass `xeokitViewer` directly to the new toolbar and context menu instead of through the shim ref.
- Remove shim ref construction that's no longer needed for toolbar (keep it if other components still use it).

---

### Technical Details

**File changes:**
- `src/components/viewer/NativeXeokitViewer.tsx` — apply neutral default colorize instead of reset
- `src/components/layout/AppLayout.tsx` — hide sidebar for viewer apps on desktop
- `src/components/viewer/ViewerToolbar.tsx` — complete rewrite (~250 lines instead of 705)
- `src/components/viewer/ViewerContextMenu.tsx` — simplify to working actions only
- `public/lib/xeokit/NavCubePlugin.js` — neutral color scheme
- `src/components/viewer/NativeViewerShell.tsx` — updated props/wiring

