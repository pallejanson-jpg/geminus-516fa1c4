

## Fix 2D Mode in 3D Viewer

### Root Cause Analysis

The current 2D mode implementation manually creates xeokit `SectionPlane` objects via 4 fallback strategies in `useSectionPlaneClipping.ts`. This is fragile because:

1. The Asset+ UMD bundle does NOT expose the `SectionPlane` constructor on `window.xeokit`
2. No existing `SectionPlane` instances exist to copy the constructor from (Strategy 2-4 fail)
3. The low-level `_sectionPlanesState` fallback (Method 4) creates a fake object that does not trigger the GPU clipping pipeline
4. Result: the clipping planes are "created" but nothing actually clips in the scene

Meanwhile, the Asset+ viewer **already has built-in APIs** that handle this correctly:
- `assetViewer.setShowFloorplan(true/false)` -- toggles 2D floor plan mode
- `assetViewer.cutOutFloorsByFmGuid(fmGuid, includeRelated)` -- clips to a specific floor
- `assetView.setNavMode('planView')` -- sets ortho top-down camera
- `assetView.clearSlices()` -- removes all section planes

These APIs are already used elsewhere in the codebase (e.g., `AssetPlusViewer.tsx` line 2445 uses `cutOutFloorsByFmGuid` successfully for floor navigation).

### Solution: Use Built-in Asset+ APIs

Replace the manual SectionPlane creation with calls to the Asset+ viewer's own 2D mode APIs.

### Changes

**1. `src/components/viewer/ViewerToolbar.tsx` -- `handleViewModeChange`**

Replace the current 2D toggle logic (lines 329-372) with:

```text
if (mode === '2d') {
  // Use Asset+ built-in floor plan mode
  const assetViewer = viewerRef.current?.$refs?.AssetViewer;
  const assetView = assetViewer?.$refs?.assetView;

  if (currentFloorId && currentFloorBounds) {
    // If a floor is selected, cut to it + enable floor plan view
    const floorBounds = calculateFloorBounds(currentFloorId);
    if (floorBounds) {
      // Use built-in setShowFloorplan if available
      assetViewer?.setShowFloorplan?.(true);
    }
  }

  // Set ortho top-down camera
  assetView?.setNavMode?.('planView');

  // Also apply our clipping as backup for models
  // that don't support setShowFloorplan
  if (currentFloorId) {
    applyFloorPlanClipping(currentFloorId);
  } else {
    const sceneAABB = viewer.scene?.getAABB?.();
    if (sceneAABB) applyGlobalFloorPlanClipping(sceneAABB[1]);
  }

  viewer.camera.projection = 'ortho';
  // ... camera positioning (keep existing bounds calculation)
} else {
  // Back to 3D
  const assetViewer = viewerRef.current?.$refs?.AssetViewer;
  assetViewer?.setShowFloorplan?.(false);
  removeSectionPlane();
  if (currentFloorId) applyCeilingClipping(currentFloorId);
  viewer.camera.projection = 'perspective';
  assetView?.viewFit(undefined, true);
}
```

**2. `src/hooks/useSectionPlaneClipping.ts` -- Improve SectionPlane creation reliability**

Add a new Strategy 0 before the existing ones: use the Asset+ viewer's own `clearSlices` to first clear, then use the xeokit viewer's `scene.createSectionPlane` if available:

```text
// Method 0: Use viewer.scene.createSectionPlane() if available (some xeokit builds expose it)
if (typeof scene.createSectionPlane === 'function') {
  try {
    const plane = scene.createSectionPlane({ id, pos, dir, active: true });
    return plane;
  } catch (e) { /* fall through */ }
}
```

Also improve Method 4 (_sectionPlanesState) to call `scene.fire("sectionPlaneCreated", ...)` which triggers xeokit's internal clipping pipeline.

**3. `src/components/viewer/ViewerToolbar.tsx` -- Camera positioning fix**

Set `viewer.camera.projection = 'ortho'` BEFORE `cameraFlight.flyTo` (not after), so the ortho projection is active during the fly animation. Also set the ortho scale explicitly:

```text
viewer.camera.projection = 'ortho';
viewer.camera.ortho.scale = h;
viewer.cameraFlight.flyTo({
  eye: [cx, cy + h, cz],
  look: [cx, cy, cz],
  up: [0, 0, -1],
  duration: 0.5
});
```

**4. Add diagnostic logging**

Add a console warning when all SectionPlane creation methods fail, including which methods were attempted and what was found, so we can debug more easily if it still fails for specific models.

### Files Changed

1. **`src/components/viewer/ViewerToolbar.tsx`** -- Use `setShowFloorplan` + `setNavMode('planView')` for 2D toggle; fix camera projection ordering
2. **`src/hooks/useSectionPlaneClipping.ts`** -- Add `scene.createSectionPlane` method; improve `_sectionPlanesState` fallback to fire events; better diagnostics

### Expected Result

- 2D mode will use the Asset+ viewer's proven built-in floor plan clipping
- Camera switches to ortho top-down correctly
- Manual SectionPlane creation serves as backup, not primary method
- Switching back to 3D properly restores perspective and clears clipping
