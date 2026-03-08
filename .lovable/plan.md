

## Problem Summary
1. **10-12s load time** — viewer component itself takes too long to initialize
2. **No fit-view after load** — camera stays at default `[0, 20, 40]` after removing auto-fit, building not visible
3. **2D mode (standalone) broken** — nothing renders
4. **Split 2D/3D slow on first load** — StoreyViewsPlugin polling up to 90 retries × 300ms
5. **Room labels in 2D split** — need black text on transparent/white background (no dark badge)

## Root Causes

### A) No fit-view
In `NativeXeokitViewer.tsx` line 454, we removed ALL camera adjustment. When no saved start view exists, camera stays at `[0, 20, 40]` looking at origin — building is likely off-screen. **Fix**: Add a simple `viewFit` (instant, no animation) to `scene.aabb` as fallback when no `LOAD_SAVED_VIEW_EVENT` arrives within 500ms after models load.

### B) 2D mode broken
The standalone 2D mode (`viewMode === '2d'`) dispatches `VIEW_MODE_REQUESTED_EVENT` which triggers ceiling clipping + ortho in the toolbar. But the NativeViewerShell's `VIEW_MODE_REQUESTED_EVENT` handler relies on the toolbar being mounted. On mobile, when `viewMode === '2d'`, the same `NativeViewerShell` is used (line 945-951 in UnifiedViewer). The 2D logic in the toolbar needs the viewer ready + models loaded. The issue is likely timing — 2D events dispatched before models load. Need to re-dispatch after `VIEWER_MODELS_LOADED`.

### C) Split 2D slow
StoreyViewsPlugin init polls every 300ms up to 90 times (27 seconds max). It also waits for `metaStoreyCount > 0`. The `VIEWER_MODELS_LOADED` event handler resets attempts and retries — but the initial `tryInit()` on mount races before models are loaded. **Fix**: Don't start polling on mount; only start on `VIEWER_MODELS_LOADED`.

### D) Room labels styling
Line 418 in `useRoomLabels.ts`: `background: hsl(var(--background) / 0.6)` with border and shadow. User wants: black text, white/transparent background, no badge look.

## Plan

### 1. Add instant viewFit fallback (`NativeXeokitViewer.tsx`)
After line 487 (VIEWER_MODELS_LOADED dispatch), add a delayed check: if no `LOAD_SAVED_VIEW_EVENT` is received within 500ms, do `viewer.cameraFlight.flyTo({ aabb: viewer.scene.aabb, duration: 0 })` — instant fit, no animation/rotation.

### 2. Fix SplitPlanView init speed (`SplitPlanView.tsx`)
- Remove the initial `tryInit()` call on mount (line 147)
- Only start init when `VIEWER_MODELS_LOADED` fires
- Reduce max retry attempts from 90 to 20
- Reduce retry interval from 300ms/1000ms to 200ms

### 3. Fix standalone 2D mode (`UnifiedViewer.tsx`)
The 2D dispatch logic at line 260-293 already re-dispatches on `VIEWER_MODELS_LOADED`. Check that the timing is correct. The real issue may be that 2D mode needs section plane clipping which requires the viewer to have storeys. Ensure the `VIEW_MODE_2D_TOGGLED_EVENT` fires after models are loaded, not before.

### 4. Room labels: black text, no background (`useRoomLabels.ts`)
Change the label style at line 414-435:
- `background: transparent` (or `background: none`)
- `color: #000` (black text)  
- Remove `border` and `box-shadow`
- Keep `text-shadow: 0 0 3px white, 0 0 3px white` for readability on plan

## Files to Edit
- `src/components/viewer/NativeXeokitViewer.tsx` — add instant viewFit fallback
- `src/components/viewer/SplitPlanView.tsx` — event-driven init only
- `src/hooks/useRoomLabels.ts` — transparent labels with black text
- `src/pages/UnifiedViewer.tsx` — ensure 2D mode fires after models loaded

