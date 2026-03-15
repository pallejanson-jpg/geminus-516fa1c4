

# ViewerMockup — Final Tweaks

## Changes in `src/pages/ViewerMockup.tsx`

### 1. Move "Open IFC" below Issues, above Settings
Reorder `MENU_ITEMS` so `openIfc` sits between `issues` and `settings`.

### 2. Rename View Modes
Update `VIEW_MODES` to 5 options with short labels:

| mode | label |
|------|-------|
| `2d` | 2D |
| `2d3d` | 2D + 3D |
| `3d` | 3D |
| `3d360` | 3D + 360 |
| `360` | 360 |

### 3. Gray out 360 modes when no Ivion Site ID
Add a mock `hasIvionSiteId` boolean (hardcoded `false` for now). The two 360-containing modes (`3d360`, `360`) render as disabled/grayed out with a subtitle "Requires 360 connection" when `hasIvionSiteId` is false. Clicking them shows a toast instead of switching mode.

