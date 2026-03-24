

# Plan: Nav Graph Editor in Pure 2D Mode

## What
Currently the Nav Graph Editor only works in Split 2D/3D mode because it overlays `SplitPlanView`. In pure 2D mode, xeokit switches to orthographic top-down but no `SplitPlanView` is rendered, so there's nothing to overlay the editor on.

## Solution
Render a fullscreen `SplitPlanView` in pure 2D mode as well (when the nav panel is open and in edit mode), with the `NavGraphEditorOverlay` and `RouteDisplayOverlay` mounted on it — identical to how it works in split mode.

## Changes

### File: `src/pages/UnifiedViewer.tsx`

1. **Add a 2D nav overlay block** after the existing `isSplit2D3D` block (~line 985):
   - When `is2DMode && navPanelOpen`, render a fullscreen `SplitPlanView` (absolute, inset-0, z-20) with:
     - `navigationOverlay` containing `NavGraphEditorOverlay` (when `navEditMode`) or `RouteDisplayOverlay` (when route active)
     - `onRoomLabelsChange={setPlanRoomLabels}` for room label data
     - `monochrome`, `lockCameraToFloor={false}`, `syncFloorSelection={false}`
   - This overlays the xeokit canvas, giving users the same plan-based editing experience as split mode

2. **No changes to NavGraphEditorOverlay or NavigationPanel** — they already work with percentage-based coordinates on any `SplitPlanView`

## Technical Notes
- The `SplitPlanView` uses the same `viewerRef` to generate storey maps from the loaded xeokit model
- In 2D mode the xeokit viewer is still mounted (it drives the storey plugin), just hidden behind the fullscreen plan view
- Room labels are shared via the same `planRoomLabels` state

