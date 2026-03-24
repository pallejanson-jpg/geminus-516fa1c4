

# Plan: Fix Right Menu Issues — Spaces Toggle, Annotations, Color Filter, 2D Mode

## Issues Identified

1. **Show Spaces stuck ON** — The `showSpaces` state in `NativeViewerShell` initializes to `false`, but `FORCE_SHOW_SPACES_EVENT` listeners and the `onShowSpacesChanged` shim can force it on without proper toggle-off path. The `handleToggleSpaces` in `VisualizationToolbar` calls `onShowSpacesChange` which should work, but the shim's `onShowSpacesChanged` applies a beige color `[0.898, 0.894, 0.890]` instead of light blue. Need to verify the toggle-off path actually hides spaces.

2. **Show Spaces should use light blue** — The `FORCE_SHOW_SPACES` handler in `NativeXeokitViewer` already uses light blue `[184/255, 212/255, 227/255]`, but the `onShowSpacesChanged` shim in `NativeViewerShell` uses beige `[0.898, 0.894, 0.890]`. These need to be unified to light blue.

3. **Annotations don't work** — `handleToggleAnnotations` dispatches `TOGGLE_ANNOTATIONS` event but nothing in `NativeXeokitViewer` listens for it. The annotation system expects an Asset+ viewer `annotationsPlugin` that doesn't exist in the native viewer. Need to add a listener that creates/shows HTML marker annotations from the `assets` table data.

4. **Annotation SidePopPanel hides under header** — The `SidePopPanel` uses `top: parentPosition.y` which can be 0, placing it under the header bar. Need to clamp `top` to at least the header height (~48px).

5. **Color filter doesn't work** — The `ObjectColorFilterPanel` applies colors but they get immediately overwritten by architect colors or space visibility changes. Need to check the apply/reset lifecycle.

6. **2D mode objects have height** — The 2D mode already applies section plane clipping via `applyFloorPlanClipping` and sets orthographic top-down camera. The objects having height is expected from the clipping approach. The user wants a truly flat 2D plan. The current `clipHeight` slider in Settings controls the cut height — this IS the 2D control. Need to ensure spaces are flat (lower opacity, offset already applied at line 862-865).

7. **Remove 2D/3D switch from bottom toolbar** — The `viewMode` tool in `ViewerToolbar` renders the 2D/3D toggle button. Remove it from the bottom toolbar since the mode switcher in the header/overlay handles this.

## Changes

### 1. Fix Show Spaces toggle — unify color + ensure toggle-off works
**File: `src/components/viewer/NativeViewerShell.tsx`**
- In `onShowSpacesChanged` shim (line 418), change beige `[0.898, 0.894, 0.890]` to light blue `[0.72, 0.83, 0.89]` (same as `NativeXeokitViewer`)
- Ensure when `show=false`, entities are properly hidden (already done at line 422-424)
- The toggle-off issue is likely that `FORCE_SHOW_SPACES` events from RoomVisualizationPanel keep re-enabling. Add a guard: when user explicitly toggles OFF via the switch, set a flag that prevents auto-re-enable until user toggles ON again.

### 2. Fix annotation visibility
**File: `src/components/viewer/NativeXeokitViewer.tsx`**
- Add a `TOGGLE_ANNOTATIONS` event listener that:
  - Fetches annotation assets from `assets` table where `annotation_placed = true` and `building_fm_guid` matches
  - Creates HTML overlay markers (div elements) positioned at each asset's 3D coordinates
  - Toggles their visibility on show/hide
  - Uses `annotation_symbols` colors for marker styling

### 3. Fix SidePopPanel z-index and position
**File: `src/components/viewer/SidePopPanel.tsx`**
- Clamp `top` to minimum `56px` (below header) to prevent hiding under header bar
- Increase z-index to `z-[65]` to ensure it's above the main panel's `z-[60]`

### 4. Fix color filter persistence
**File: `src/components/viewer/ObjectColorFilterPanel.tsx`**
- After applying colors, dispatch a custom event `COLOR_FILTER_ACTIVE` that other systems (architect colors, space toggle) can check before overwriting
- Add a debounce/guard so applied filter colors aren't immediately cleared

### 5. Improve 2D mode flatness
**File: `src/components/viewer/ViewerToolbar.tsx`**
- In the 2D mode handler, for space entities: set lower opacity (0.1) and apply a stronger Y-offset downward so they don't compete with selectable objects above them
- Ensure equipment/instances remain pickable and spaces only get selected when clicking empty floor area

### 6. Remove 2D/3D from bottom toolbar
**File: `src/components/viewer/ViewerToolbar.tsx`**
- Remove `viewMode` from `ALL_TOOLS` array or filter it out from rendering
- The 2D/3D switch remains available in the mode switcher header (MobileViewerOverlay / UnifiedViewer header)

## Files to Modify

| File | Change |
|------|--------|
| `src/components/viewer/NativeViewerShell.tsx` | Unify space color to light blue, fix toggle-off path |
| `src/components/viewer/NativeXeokitViewer.tsx` | Add TOGGLE_ANNOTATIONS listener with HTML markers |
| `src/components/viewer/SidePopPanel.tsx` | Clamp top position, raise z-index |
| `src/components/viewer/ObjectColorFilterPanel.tsx` | Guard applied colors from being overwritten |
| `src/components/viewer/ViewerToolbar.tsx` | Remove viewMode from toolbar, improve 2D space flatness |
| `src/components/viewer/VisualizationToolbar.tsx` | Minor: ensure spaces toggle dispatches correct event |

