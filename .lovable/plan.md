

# Plan: Fix 2D/3D Split Mode, Speed Settings, and Space Height

## Analysis of Core Problem

The xeokit official minimap tutorial uses a fundamentally different approach from our `SplitPlanView`:

**xeokit approach**: The plan image is **translated and rotated** to keep the camera position at the center of the minimap viewport. The image moves — the marker stays fixed at center. This gives an intuitive "GPS navigation" feel.

**Our approach**: Static image with a blue dot overlay that moves. The dot position calculation uses manual AABB normalization that frequently drifts, and the visual coupling is weak.

Additionally, 2D clicks currently select objects in the 3D viewer (`pickResult.entity.selected = true`), which the user explicitly does not want.

## Changes

### 1. Move Speed Settings to Right Menu (VisualizationToolbar)
**File: `src/components/viewer/VisualizationToolbar.tsx`**
- Add a "Navigation speed" slider under "Viewer settings" collapsible (after Lighting Controls)
- Read/write `localStorage('viewer-nav-speed')` — same key as ViewerToolbar
- Apply changes live to `viewer.cameraControl` rates (dispatch a custom event `NAV_SPEED_CHANGED`)
- Show separate base values for mobile vs desktop (display-only label, not separate sliders — the multiplier applies to both)

**File: `src/components/viewer/NativeXeokitViewer.tsx`**
- Add listener for `NAV_SPEED_CHANGED` to update cameraControl rates in real-time without requiring viewer restart

### 2. Remove Object Selection from 2D Plan Clicks
**File: `src/components/viewer/SplitPlanView.tsx`**
- In `handleClick`, remove the block at lines 888-905 that sets `pickResult.entity.selected = true` and dispatches `VIEWER_SELECT_ENTITY`
- 2D clicks should ONLY navigate the 3D camera position — no object selection, no green highlights
- Keep entity picking for hover tooltip only (cursor change + name display)

### 3. Fix 2D Plan Camera Tracking (Adopt xeokit Minimap Pattern)
**File: `src/components/viewer/SplitPlanView.tsx`**
- Replace the static-image-with-moving-dot approach with the xeokit-recommended pattern:
  - Use `storeyViewsPlugin.worldPosToStoreyMap()` to get camera position in image coords (already done)
  - Use `storeyViewsPlugin.worldDirToStoreyMap()` to get camera direction in image coords (NEW)
  - **Transform the image** using CSS `translate()` and `rotate()` so that the camera position is always centered in the viewport
  - Keep a fixed marker (triangle + dot) at the center of the container
  - This means: `el.style.transform = translate(centerX - imagePos.x, centerY - imagePos.y) rotate(angle)`
- This replaces the current absolute-positioned blue dot which drifts when pan/zoom changes

### 4. Improve 2D Plan Visual Quality
**File: `src/components/viewer/SplitPlanView.tsx`**
- Increase contrast filter from `1.4` to `1.8` for bolder wall lines
- Increase wall edge width from `6` to `8`
- Make wall fill darker: `[0.05, 0.05, 0.05]` instead of `[0.1, 0.1, 0.1]`
- Increase space opacity from `0.5` to `0.6` for better room visibility with lighter gray `[0.95, 0.95, 0.95]`

### 5. Make Space Objects Much Lower in 2D Mode
**File: `src/components/viewer/NativeXeokitViewer.tsx`** (or the 2D mode handler)
- When 2D/plan mode is activated, for all `IfcSpace` entities:
  - Set opacity to `0.08` (nearly invisible but still pickable)
  - Ensure they render below equipment so equipment is the primary pick target
- The section plane clipping height already controls the "slice" — spaces should not compete with equipment for picking

### 6. Strengthen 3D Camera Response to 2D Navigation
**File: `src/pages/UnifiedViewer.tsx`**
- In the `SPLIT_PLAN_NAVIGATE` handler, ensure the 3D camera actually follows:
  - Add `viewer.camera.projection = 'perspective'` before flyTo (ensure not stuck in ortho)
  - Reduce flyTo duration from `0.5` to `0.3` for snappier response
  - After flyTo, force canvas redraw (already done, but add `viewer.scene.fire('tick')` as additional trigger)

## Files to Modify

| File | Change |
|------|--------|
| `src/components/viewer/VisualizationToolbar.tsx` | Add speed slider under Viewer Settings |
| `src/components/viewer/NativeXeokitViewer.tsx` | Live speed update listener, space opacity in 2D |
| `src/components/viewer/SplitPlanView.tsx` | Remove 2D object selection, adopt xeokit minimap transform pattern, improve visual quality |
| `src/pages/UnifiedViewer.tsx` | Strengthen 3D camera flyTo response |

