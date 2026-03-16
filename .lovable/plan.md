

# Fix Split 2D/3D Camera Sync & Ivion 360 Mobile Scaling

## Issue 1: Split View — 3D Camera Doesn't Follow 2D Clicks Correctly

**Root cause found in `SplitPlanView.tsx` line 798-815:**

The `handleClick` function sets:
```
nextEye  = [worldPos[0], currentEyeY, worldPos[2]]
nextLook = [worldPos[0], worldPos[1], worldPos[2]]
```

Eye and Look have **identical X and Z** — the camera looks **straight down** at the point. In 3D perspective this produces a useless vertical view where you see nothing meaningful. After the first click, the camera is stuck in a top-down pose and subsequent clicks produce no visible change since the camera just moves straight-down to a new point.

**Fix:** Preserve the camera's current horizontal offset (eye-to-look vector) and translate both eye and look to the new position:

```typescript
const offsetX = eye[0] - look[0];
const offsetZ = eye[2] - look[2];
// If offset is zero (already top-down), create a default offset
const hasOffset = Math.abs(offsetX) > 0.1 || Math.abs(offsetZ) > 0.1;
const finalOffsetX = hasOffset ? offsetX : 0;
const finalOffsetZ = hasOffset ? offsetZ : -10;

nextEye  = [worldPos[0] + finalOffsetX, currentEyeY, worldPos[2] + finalOffsetZ]
nextLook = [worldPos[0], worldPos[1], worldPos[2]]
```

This way the 3D camera moves to show the clicked area from the same relative angle, like the Dalux reference where clicking the 2D plan pans the 3D view to that location while preserving the viewing angle.

Also reduce `duration` from 0.8 to 0.5 for snappier response.

**File:** `src/components/viewer/SplitPlanView.tsx` (lines ~798-815)

---

## Issue 2: Ivion 360 — UI Elements Too Large on Mobile

**Root cause in `Ivion360View.tsx` line 219-227:**

The current mobile CSS rules scale elements to 0.5-0.62 but miss key elements:
- The **search bar** at the top (`.iv-search`, `.iv-header`, or similar top bar element)
- The **alternate viewer thumbnail** in the bottom-right corner (likely `.iv-minimap` which is set to `display: none` but may have changed class name, or a different panel)

**Fix:** Add more aggressive CSS rules targeting all known Ivion SDK UI elements:

```css
ivion .iv-sidebar { display: none !important; }
ivion .iv-sidebar-toggle { transform: scale(0.5); transform-origin: top left; }
ivion .iv-floor-selector { transform: scale(0.45); transform-origin: bottom left; max-height: 28vh !important; }
ivion .iv-controls { transform: scale(0.45); transform-origin: bottom right; }
ivion .iv-minimap { transform: scale(0.4); transform-origin: bottom right; }
ivion .iv-toolbar { transform: scale(0.45); transform-origin: bottom center; }
ivion .iv-button { font-size: 8px !important; padding: 2px 4px !important; }
ivion .iv-navigation { transform: scale(0.4); transform-origin: bottom right; }
/* Target top search/header bar */
ivion .iv-header, ivion [class*="search"], ivion [class*="Search"] {
  transform: scale(0.5); transform-origin: top center;
}
/* Target any floating panel/overlay */
ivion [class*="panel"], ivion [class*="Panel"] {
  transform: scale(0.45); transform-origin: bottom right;
}
```

Also **un-hide the minimap** (remove `display: none`) and instead scale it aggressively so the user can see the alternate view thumbnail but it doesn't dominate the screen.

**File:** `src/components/viewer/Ivion360View.tsx` (lines 219-227)

---

## Files to Edit
1. `src/components/viewer/SplitPlanView.tsx` — Fix camera flyTo to preserve horizontal offset
2. `src/components/viewer/Ivion360View.tsx` — More aggressive mobile CSS scaling

