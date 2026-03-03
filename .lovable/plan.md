
# Plan: Fix Alignment in Split Screen 3D/360

## Two Issues Found

### Issue 1: Split mode does not use Native Xeokit
In `UnifiedViewer.tsx` line 452, `shouldUseNative3D` is only true for `3d` and `2d` modes. When `viewMode === 'split'`, it falls through to the legacy `AssetPlusViewer`. This needs to include `split` mode.

**Fix**: Change line 452 to also include `split` in `shouldUseNative3D`, and update the 3D point picking in `AlignmentPointPicker` to work with the native xeokit viewer instead of relying on `__assetPlusViewerInstance`.

### Issue 2: 360 position is auto-captured instead of user-clicked
`AlignmentPointPicker` captures the current panorama image location (camera position) when the user clicks "Fanga position". This gives the scan position of the panorama camera, not a specific point the user tapped in the 360 view.

**What the user wants**: Click a specific point on a surface in the 360 view, then click the same point in 3D.

**Fix**: Change step 1 so the user taps/clicks directly in the 360 panorama to pick a 3D surface point (using `mainView.getClickPosition()` or similar SDK raycast), rather than reading the image location. If the SDK does not support surface picking, we keep image location but require the user to navigate first and then explicitly confirm -- but we must NOT auto-populate on mount.

### Issue 3: Build error (cesium)
The build fails because `resium` imports `cesium` which is not installed (only `@cesium/engine` is). Need to add `cesium` as an alias or external in vite config.

## Changes

### 1. `vite.config.ts`
Add cesium alias to resolve the build error:
```ts
resolve: {
  alias: {
    "@": path.resolve(__dirname, "./src"),
    "cesium": "@cesium/engine",
  },
}
```

### 2. `UnifiedViewer.tsx`
Change `shouldUseNative3D` to include `split` mode:
```ts
const shouldUseNative3D = viewMode === '3d' || viewMode === '2d' || viewMode === 'split';
```

### 3. `AlignmentPointPicker.tsx`
- Remove auto-capture of position. Start step as `'picking360'` but do NOT read position until user explicitly clicks in the 360 view.
- Add a click listener on the Ivion SDK container to capture the clicked 3D position (using the SDK's raycast/pick API if available, or the current image location at the moment of click).
- For the 3D picking step: detect the native xeokit viewer from the canvas element directly (query the `NativeXeokitViewer` instance on `window`) instead of looking for `__assetPlusViewerInstance` which is only set by the legacy viewer.

### 4. `NativeXeokitViewer.tsx`
Expose the xeokit viewer instance on `window.__nativeXeokitViewer` so that `AlignmentPointPicker` can access it for surface picking in split mode.

## Summary
- Fix build error (cesium alias)
- Use native xeokit in split mode
- Change alignment point picking to require explicit user clicks in both 360 and 3D views
- Wire up native xeokit viewer for 3D surface picking
