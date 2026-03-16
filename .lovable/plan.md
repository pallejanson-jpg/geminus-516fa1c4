

# Mobile Viewer: Dalux FM-inspired Redesign

Reference image shows the target: Dalux FM's clean 2D/3D mobile layout with minimal chrome and maximum canvas area.

## Key Design Elements from Reference

```text
┌─────────────────────────────────┐
│                          [3D]   │  ← Small floating button, top-right
│                          [⌨]   │
│                          [⋮]   │
│                                 │
│    Clean black-line 2D plan     │  ← Full-bleed canvas, white bg
│    (Dalux architectural style)  │
│                                 │
│                                 │
│                                 │
│          [ 02  ˄ ]              │  ← Centered floor pill with popover
│                                 │
│  [Platser] [Användare] [Mer]   │  ← Bottom tab bar
└─────────────────────────────────┘
```

## Changes (4 items)

### 1. Floor Switcher → Single Centered Popover Pill
Replace the horizontal pill strip with a single compact button centered above the bottom toolbar, styled like Dalux's "02 ˄" pill. Tapping opens a `Popover` (opening upward) listing all floors. Active floor highlighted. Tap a floor to solo it, tap again to show all.

### 2. Move Mode Switcher into Action Sheet
Remove the mode buttons from the transparent top bar. The top bar becomes just `[X]` left + `[☰]` right (or just `[☰]`). Modes (2D, 2D/3D, 3D, 360) are already wired in the Action Sheet drawer under "View Mode" — that becomes the only way to switch on mobile.

### 3. Fix 2D Mode Wall Clipping
`ViewerToolbar` is already always mounted (hidden via CSS with `opacity: 0`, confirmed in NativeViewerShell line 566). The `VIEW_MODE_2D_TOGGLED_EVENT` listener exists. Verify the 2D clipping activates properly when dispatched from `handleModeChange('2d')`. If the section plane isn't created, add a fallback: after dispatching the event, also dispatch `FLOOR_SELECTION_CHANGED_EVENT` with the current floor's bounds to trigger clipping via `useSectionPlaneClipping`.

### 4. Fix Split View 3D Camera Follow
Change `SplitPlanView` props from `syncFloorSelection={false} lockCameraToFloor={false}` to `syncFloorSelection={true} lockCameraToFloor={true}`. This enables the existing click-to-flyTo logic and floor-locked camera behavior in the 3D half.

## File to Edit
- `src/components/viewer/mobile/MobileViewerPage.tsx`

## What Stays Functional
All existing tool wiring (orbit, pan, select, measure, section, xray, reset) unchanged. Action sheet menu items unchanged. Insights panel unchanged.

