

# Fix Plan — Pure 2D Issues + Split 2D/3D Camera Sync

## Clarification
- **"2D"** = pure 2D mode (xeokit in 2D plan view via `VIEW_MODE_2D_TOGGLED_EVENT`)
- **"2D/3D"** = `split2d3d` mode where SplitPlanView is on the left and 3D viewer on the right

## Issues & Fixes

### 1. Pure 2D — Clicks hit area objects instead of rooms
**Problem:** `SplitPlanView.handleClick` (line 756) only does camera flyTo. The hover handler uses `pickStoreyMap` but click doesn't pick entities at all. Large IfcSpace/area objects cover the floor and block smaller room picks.

**Fix in `SplitPlanView.tsx`:**
- In `handleClick`, after computing `worldPos`, also call `pickStoreyMap` to get the clicked entity
- Filter out large area types (`IfcSite`, `IfcBuilding`) — skip entities whose AABB covers >80% of the floor AABB
- If a valid entity is found, dispatch `VIEWER_SELECT_ENTITY` custom event with `entityId` and `originalSystemId` (fm_guid)
- Add `onEntityClick` callback prop for parent to handle (e.g. open properties)

### 2. Pure 2D — Room labels don't follow pan/zoom
**Problem:** The room labels overlay container uses `absolute inset-0` (line 1083) which is correct and IS inside the transformed parent div (line 1059). The labels should follow pan/zoom since they're children of the transformed container.

**Likely root cause:** The `pointer-events-none` on the overlay plus the `relative` + `inline-block` parent may cause `inset-0` to not resolve to the image dimensions. The overlay may be 0×0.

**Fix in `SplitPlanView.tsx`:**
- Instead of `inset-0`, set explicit `width` and `height` on the labels container matching `imgRef.current.naturalWidth` and `imgRef.current.naturalHeight` (the image's intrinsic pixel dimensions, which match the rendered size since `max-w-none` prevents shrinking)

### 3. Properties dialog — can't close + shows "No data found"
**Problem 1:** Close button exists (line 1252) but may be blocked by event propagation or z-index.

**Fix in `UniversalPropertiesDialog.tsx`:**
- Add `e.stopPropagation()` on the close button click handler
- Ensure `onClose` is called with no conditions

**Problem 2:** Entity GUID from 2D pick is a xeokit metaObject ID, not a database `fm_guid`. The code tries `asset_external_ids` fallback (line 154) only when `entityId` prop is set, but the component receives the ID as `fmGuids` prop.

**Fix in `UniversalPropertiesDialog.tsx`:**
- When no assets found and `entityId` is available, also try resolving via `originalSystemId` from xeokit metaScene before querying the database
- Pass `entityId` properly from the context menu / click handler

**Fix in `NativeViewerShell.tsx`:**
- Ensure `propertiesEntity` stores both `fmGuid` and `entityId` separately, and passes `entityId` to `UniversalPropertiesDialog`

### 4. Split 2D/3D — 3D doesn't follow position from 2D clicks
**Problem:** In `split2d3d` mode, `SplitPlanView` clicks do `viewer.cameraFlight.flyTo()` on the shared xeokit viewer — this SHOULD move the 3D camera since both panels share the same viewer instance. But `syncFloorSelection={false}` is set (line 839), and the click handler moves the camera to a first-person view (eye at 1.5m above floor), which may not be the desired behavior for split mode.

**Fix in `SplitPlanView.tsx`:**
- Detect if the component is in split2d3d context (new prop `isSplitMode`)
- In split mode, instead of first-person flyTo, do a top-down camera adjustment: move the 3D camera's `look` target to the clicked world position while preserving the current camera angle and distance
- Alternatively, dispatch a custom event `SPLIT_PLAN_NAVIGATE` with the world position, and have UnifiedViewer / NativeViewerShell listen and fly the 3D camera there with its current perspective

**Fix in `UnifiedViewer.tsx`:**
- Pass `isSplitMode={true}` to SplitPlanView when in split2d3d mode

## Files to Edit
1. `src/components/viewer/SplitPlanView.tsx` — entity picking on click, label sizing fix, split-mode camera dispatch
2. `src/components/common/UniversalPropertiesDialog.tsx` — close button fix, improved GUID resolution
3. `src/components/viewer/NativeViewerShell.tsx` — proper entityId/fmGuid separation for properties
4. `src/pages/UnifiedViewer.tsx` — pass isSplitMode prop, listen for SPLIT_PLAN_NAVIGATE event

