

# Context-Sensitive Quick Actions in Portfolio

## Current State

The Quick Actions are **partially context-sensitive**:

- **Assets button**: Already works correctly. `onShowAssets(facility)` passes the current facility (Building/Storey/Space), and `getAssetsForFacility()` in PortfolioView already filters by the appropriate level.

- **Viewer button**: Partially works. The `navigateToViewer()` in QuickActions correctly builds URL params with `floor=` for Storeys and `entity=` for Spaces. However, on desktop the `UnifiedViewer` passes `entityFmGuid` to `AssetPlusViewer` (legacy path) but **not** to `NativeViewerShell`. The zoom-to-entity only works if `VIEWER_ZOOM_TO_OBJECT` event is dispatched, which doesn't happen from the URL-based flow.

## Problem

When navigating from a **Space** in the Portfolio to the Viewer, the floor is correctly isolated (via `floor=` URL param → `FLOOR_SELECTION_CHANGED_EVENT`), but the **entity zoom-to** never fires because `UnifiedViewer` doesn't dispatch `VIEWER_ZOOM_TO_OBJECT` for the native viewer path.

## Changes

### File: `src/pages/UnifiedViewer.tsx`
- Add a `useEffect` that watches `entityFmGuid` and `viewerReady`. When both are truthy and the native viewer is being used (`shouldUseNative3D`), dispatch `VIEWER_ZOOM_TO_OBJECT` event with the `entityFmGuid` after a short delay (1.5s to allow model and floor clipping to settle).
- This connects the URL-based `entity=` param to the existing zoom-to handler in `NativeViewerShell`.

```typescript
// Dispatch zoom-to-entity for native viewer when entity param is present
useEffect(() => {
  if (!entityFmGuid || !viewerReady || !shouldUseNative3D) return;
  const timer = setTimeout(() => {
    window.dispatchEvent(new CustomEvent('VIEWER_ZOOM_TO_OBJECT', { 
      detail: { fmGuid: entityFmGuid } 
    }));
  }, 1500);
  return () => clearTimeout(timer);
}, [entityFmGuid, viewerReady, shouldUseNative3D]);
```

This is the only missing piece. The floor isolation already works via URL params, and the Assets list already filters correctly by context.

