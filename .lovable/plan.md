

# Analysis: Labradorgatan 16 Viewer Issues

## Issue 1: "No XKT models found"

**Root cause:** Building `cc27795e` (Labradorgatan 16) has hierarchy data in the `assets` table (1 Building, 7 Storeys, 100+ Instances from Asset+ sync), but **zero rows in `xkt_models`** and **zero files in the `xkt-models` storage bucket**. The 3D geometry was never synced or uploaded.

This building was synced from Asset+ for metadata only — no XKT conversion has been performed. The viewer correctly reports "No XKT models found" because there genuinely are none.

**Fix options:**
- Sync XKT models from Asset+ (run `asset-plus-sync` with `sync-xkt-building` action for this building)
- Or upload an IFC file for this building via Settings → Buildings

This is a data issue, not a code bug.

## Issue 2: Back button not working

**Root cause:** The `handleGoBack` function calls `navigate('/')`, which should work. However, looking at the session replay, the user clicks the back arrow and the viewer reloads instead of navigating away. This suggests the click is hitting the wrong element or the viewer's `h-screen w-screen` container is intercepting/reloading.

Looking at the code more carefully: the back button at line 584-591 in `UnifiedViewer.tsx` calls `handleGoBack` which does `navigate('/')`. The route `/*` renders `AppLayout` (protected). This should work correctly.

The most likely cause is that the error state rendering at line 510-520 shows a "Back" button, but clicking the ArrowLeft in the header toolbar (while in error state) might cause a re-render loop. The session replay shows the viewer mounting 3 times in rapid succession (3 separate "Loading viewer..." → error cycles), suggesting `NativeViewerShell` is being remounted.

Let me check if the `viewer3dFmGuid` context is causing repeated navigation/remounting.

**Proposed fix for back button:** The `handleGoBack` navigates to `/` but does not clear `viewer3dFmGuid` from context, which could cause the main layout to immediately redirect back to `/viewer`. The `NativeViewerPage` (rendered in `MainContent` for the "3d" active app) has redirect logic that sends to `/viewer?building=...` when `viewer3dFmGuid` is set. If the user navigates to `/` but `viewer3dFmGuid` is still set and `activeApp` is still '3d', it could loop.

**Fix:** `handleGoBack` should also clear `viewer3dFmGuid` from context before navigating.

## Changes

### 1. Fix back button in UnifiedViewer

In `src/pages/UnifiedViewer.tsx`, update `handleGoBack` to clear the viewer context:

```typescript
const handleGoBack = useCallback(() => {
  setViewer3dFmGuid(null);
  navigate('/');
}, [navigate, setViewer3dFmGuid]);
```

This requires adding `setViewer3dFmGuid` from `AppContext`.

### 2. No code fix needed for the missing models

Labradorgatan 16 genuinely has no XKT models. The user needs to either:
- Trigger an Asset+ XKT sync for that building
- Upload an IFC file

I will add a more helpful error message that suggests these actions instead of the generic "Ensure models have been synced."

