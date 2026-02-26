

# Plan: Fix Room Visualization, Improve 2D Mode, Optimize 3D Loading & Move Legend

## Issues Identified

1. **Room visualization not working** — The `RoomVisualizationPanel` colorizes spaces but the legend overlay (`VisualizationLegendBar`) is positioned on the LEFT side, and the visualization may fail if `entityIdCache` is empty or spaces aren't visible.

2. **Legend bar on wrong side** — Currently `left-3 top-1/2` on desktop. Needs to move to RIGHT side.

3. **3D loading still slow** — The current XKT pipeline loads models sequentially via Asset+'s `setAvailableModelsByFmGuid`. The A-model whitelist + 3s progressive load adds latency. The `additionalDefaultPredicate` filter works but the deferred model reload triggers a full re-fetch. Memory preload (`useXktPreload`) runs but doesn't feed into Asset+'s loader — models get fetched TWICE (once by preload, once by Asset+).

4. **SplitPlanView (2D) quality issues** — Uses raw AABB boxes for rooms/walls which looks blocky and unreadable. Rooms are not selectable without hiding area objects. Rotation is not locked. No start view integration.

5. **Area objects blocking selection in both 2D and 3D** — The area object hiding only happens inside `ViewerFilterPanel.applyFilterVisibility()` which requires the filter panel to be open/initialized. Not applied globally on model load.

6. **2D mode rotation not locked** — In 2D, the camera should have fixed rotation (no orbit), only pan/zoom.

---

## Implementation Steps

### Task 1: Move visualization legend to right side of screen

**File: `src/components/viewer/VisualizationLegendBar.tsx`**
- Change desktop positioning from `left-3 top-1/2 -translate-y-1/2` to `right-3 top-1/2 -translate-y-1/2`
- This is a one-line CSS class change

### Task 2: Fix room visualization reliability

**File: `src/components/viewer/RoomVisualizationPanel.tsx`**
- The `entityIdCache` build (line ~286) retries only once on failure. Add a `modelLoadState` dependency or poll until the metaScene has objects.
- Ensure `FORCE_SHOW_SPACES_EVENT` actually makes spaces visible before colorizing.

### Task 3: Auto-hide area objects globally on model load

**File: `src/components/viewer/AssetPlusViewer.tsx`**
- In `handleAllModelsLoaded`, after hiding spaces, add a pass to hide all IfcSpace entities whose name starts with "Area" or equals "Area". This ensures area objects are always hidden regardless of whether ViewerFilterPanel is mounted.
- Make these entities `pickable = false` so they don't block selection.

### Task 4: Lock 2D rotation and improve SplitPlanView

**File: `src/components/viewer/SplitPlanView.tsx`**
- The canvas-based 2D plan currently draws AABB rectangles. To achieve the quality target (clean architectural plan), we should:
  - Draw walls as solid filled rectangles (already done) but with thicker, cleaner borders
  - Improve room fill to use lighter, more distinct colors
  - Lock pan to left-click drag (currently requires Alt+click or middle-click) — make it more intuitive
  - Remove ability to rotate (this is a canvas, not 3D, so rotation isn't an issue — it's the xeokit 3D camera in 2D mode that can rotate)

**File: `src/pages/UnifiedViewer.tsx` (or `AssetPlusViewer.tsx`)**
- When in `2d` view mode, set xeokit camera to orthographic projection and lock the `up` vector to `[0,1,0]`. Disable orbit controls so the user can only pan/zoom.
- Use the building's saved start view rotation to set the initial camera orientation for 2D.

### Task 5: Optimize 3D loading pipeline

**File: `src/hooks/useXktPreload.ts`**
- The preload hook fetches models into memory but Asset+ re-fetches them via its own XHR. To bridge this gap:
  - After preloading into memory, install a `fetch` interceptor (already partially exists in `AssetPlusViewer.tsx` via `setupCacheInterceptor`) that serves models from the memory cache.
  - Ensure the interceptor is installed BEFORE `initAssetViewer` is called.

**File: `src/components/viewer/AssetPlusViewer.tsx`**
- In the cache interceptor setup, check `isModelInMemory()` first and return a `Response` from the `ArrayBuffer` directly, avoiding a network round-trip.
- Remove the 3-second delay for progressive model loading — load deferred models immediately after the first batch renders.

### Task 6: Ensure room labels and visualization work in 2D mode

**File: `src/hooks/useRoomLabels.ts`**
- The room labels already support a `viewMode` update. Verify that the `updateViewMode('2d')` call correctly adjusts label Y positions to floor level.

**File: `src/components/viewer/RoomVisualizationPanel.tsx`**
- Room visualization should work in 2D since it colorizes entities regardless of camera mode. Verify no guard blocks it.

---

## Technical Details

### Memory-to-Asset+ bridge (Task 5)
The key performance bottleneck is that `useXktPreload` downloads XKT binaries into `xktMemoryCache`, but Asset+'s internal loader makes its own HTTP requests. The fix is to intercept `fetch`/`XMLHttpRequest` in `setupCacheInterceptor` and serve cached `ArrayBuffer` data directly:

```text
┌──────────────┐     ┌────────────────┐     ┌──────────────┐
│ useXktPreload│────→│ xktMemoryCache │────→│ fetch intercept│
│ (background) │     │ (ArrayBuffer)  │     │ serves to AP  │
└──────────────┘     └────────────────┘     └──────────────┘
```

### Area object hiding (Task 3)
Currently only `ViewerFilterPanel` detects and hides "Area" IfcSpace objects. Moving this to `handleAllModelsLoaded` ensures it runs regardless of which panels are open:

```typescript
// In handleAllModelsLoaded, after space hiding:
Object.values(metaObjects).forEach((mo: any) => {
  if (mo.type?.toLowerCase() !== 'ifcspace') return;
  const name = (mo.name || '').trim().toLowerCase();
  if (name === 'area' || name.startsWith('area ')) {
    const entity = sceneObjects[mo.id];
    if (entity) { entity.visible = false; entity.pickable = false; }
  }
});
```

### 2D rotation lock (Task 4)
In xeokit, 2D mode uses orthographic projection. To lock rotation:
- Set `camera.projection = 'ortho'`
- Disable `CameraControl.navMode = 'planView'` (xeokit built-in plan view mode that locks orbit)
- Use the saved start view's rotation to set the initial up/eye vectors

