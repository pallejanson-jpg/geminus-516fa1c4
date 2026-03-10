

## Plan: Fix 2D Mode Snap-Back + Self-Rotation

### Root Cause Analysis

**2D reverts to 3D:** Three competing `useEffect` hooks dispatch `VIEW_MODE_REQUESTED_EVENT`, creating race conditions:

1. **Effect at line 129** (UnifiedViewerContent): fires immediately on `[viewMode, floorFmGuid]` — dispatches for every change, including when `floorFmGuid` changes
2. **Effect at line 290** (UnifiedViewerContent): fires on `[viewerReady, viewMode, floorFmGuid]` — dispatches again on `VIEWER_MODELS_LOADED`
3. **Effect at line 905** (MobileUnifiedViewer): fires on `[viewMode, viewerReady]` — dispatches `'3d'` after 500ms when viewMode='3d'

The problem: Effect #3 schedules a `VIEW_MODE_REQUESTED '3d'` dispatch with a 500ms delay. If `viewerReady` changes (which it does — the effect at line 272 resets `viewerReady` to false on every `buildingData` change, then re-detects it 500ms later), the cleanup/re-fire sequence can dispatch '3d' AFTER the user has already switched to '2d'. Additionally, effect #1 fires on `floorFmGuid` changes, causing force-reapply which hides/reveals the canvas.

**Self-rotation:** The `cameraControl` retains touch inertia from previous 3D interactions. When switching to `planView` nav mode, the residual rotational momentum still applies, causing the view to spin without user input.

---

### Fix 1: Consolidate Mode Event Dispatching

**File: `src/pages/UnifiedViewer.tsx`**

- **Remove effect #3** (line 905-923 in MobileUnifiedViewer) entirely — it's redundant with effect #1
- **Guard effect #1** (line 129): only dispatch `VIEW_MODE_REQUESTED_EVENT` when `viewMode` actually changed (check `prev !== viewMode` before dispatching), not on every `floorFmGuid` change
- **Stabilize `viewerReady`** (line 272-288): don't call `setViewerReady(false)` if the viewer instance is already detected on the window — only reset when `buildingData.fmGuid` actually changes (use a ref to track previous fmGuid)

### Fix 2: Stop Self-Rotation in 2D/PlanView

**File: `src/components/viewer/ViewerToolbar.tsx`**

In the 2D branch of `handleViewModeChange`, after setting `navMode = 'planView'`, explicitly stop any ongoing inertia:
```
viewer.cameraControl.navMode = 'planView';
// Kill residual inertia
if (viewer.scene.camera) {
  viewer.scene.camera.eye = [...viewer.scene.camera.eye];
}
```

Also reduce `followPointerEnabled` to false in planView to prevent drift.

### Fix 3: Prevent Force-Reapply Flash

**File: `src/components/viewer/ViewerToolbar.tsx`**

When `isForceReapply` is true, skip the canvas hide/reveal animation (lines 604, 765-766). The clipping/styling can be reapplied without visual disruption.

---

### Summary

| File | Change |
|---|---|
| `src/pages/UnifiedViewer.tsx` | Remove duplicate effect in MobileUnifiedViewer. Guard effect #1 to only dispatch on actual mode changes. Stabilize viewerReady. |
| `src/components/viewer/ViewerToolbar.tsx` | Kill camera inertia when entering planView. Skip canvas flash on force-reapply. |

