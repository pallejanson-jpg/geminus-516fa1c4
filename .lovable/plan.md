

# Fix Hover Highlight, X-ray, and Verify Split View SDK

## Investigation Findings

### 1. Hover Highlight -- Why It Does Not Work

The current code subscribes to xeokit's `cameraControl.on('hover', ...)` event. According to xeokit's API, the `hover` event only fires **once when entering a new object**, not continuously. More critically, there is no handler for `hoverOut` or `hoverOff`, so highlights are never cleared when the mouse leaves an object and moves to empty space.

Additionally, the AssetPlus bundled xeokit version may not fire the `hover` event at all when certain tools (select, measure, slicer) are active via `useTool()`, because the CameraControl's pointer events can be suppressed by the active tool.

**Fix**: Subscribe to ALL four hover events from CameraControl:
- `hover` -- pointer enters a new entity (highlight it)
- `hoverSurface` -- pointer continues over an entity surface (keep highlighting)
- `hoverOut` -- pointer left the last entity (clear highlight)
- `hoverOff` -- pointer is over empty space (clear highlight)

This matches how `RoomVisualizationPanel.tsx` works (line 539), which successfully uses the same `(canvasCoords, hit)` signature.

### 2. X-ray -- Why It Does Not Work

The `XrayToggle` component accesses the viewer via:
```
viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer
```

This is the correct path. However, xeokit's `scene.setObjectsXRayed(objectIds, enabled)` may silently fail if:

a) The xeokit version bundled in AssetPlus uses a different method name or signature
b) The `objectIds` array is empty at the moment of toggling (models not yet loaded)

The overflow menu check `viewer.scene.xrayedObjectIds?.length` may also fail because xeokit exposes `xrayedObjectIds` as a **getter** that returns a snapshot array, and it might be named differently in the bundled version (`numXRayedObjects` or the `xrayedObjects` map).

**Fix**: 
- Add a fallback approach: iterate `scene.objects` directly and set `.xrayed = true/false` on each entity
- Add logging to confirm the viewer reference is reachable at toggle time
- Track state internally rather than reading back from xeokit

### 3. Split View SDK -- Why No Logs Appear

In `Ivion360View.tsx` line 127, SDK loading is gated by:
```typescript
if (!ivionUrl || !syncEnabled) {
  setSdkStatus('idle');
  return;
}
```

In `SplitViewer.tsx`, the `syncEnabled` prop is bound to `syncLocked`, which defaults to `false` (line from ViewerSyncContext). This means **the SDK never attempts to load** until the user clicks the "Sync ON" toggle button. That is why zero SDK logs appeared in the console.

**Fix**: Change SDK loading to trigger when `ivionUrl` is available, regardless of `syncEnabled`. The `syncEnabled` flag should only control whether camera synchronization polling is active, not whether the SDK itself loads. This way the SDK pre-loads in the background and is ready when sync is toggled on.

## Implementation Plan

### Step 1: Fix Hover Highlight (AssetPlusViewer.tsx)

In `setupHoverHighlight` (around line 1805), replace the single `hover` subscription with all four xeokit hover events:

```typescript
const setupHoverHighlight = useCallback(() => {
  const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  if (!xeokitViewer?.scene || !xeokitViewer?.cameraControl) {
    console.warn('[AssetPlusViewer] Hover setup failed - viewer/cameraControl not available');
    return;
  }

  let lastHighlightedEntity: any = null;
  const cameraControl = xeokitViewer.cameraControl;

  const highlightEntity = (entity: any) => {
    if (lastHighlightedEntity && lastHighlightedEntity !== entity) {
      try { lastHighlightedEntity.highlighted = false; } catch (e) {}
    }
    if (entity) {
      entity.highlighted = true;
      lastHighlightedEntity = entity;
    }
  };

  const clearHighlight = () => {
    if (lastHighlightedEntity) {
      try { lastHighlightedEntity.highlighted = false; } catch (e) {}
      lastHighlightedEntity = null;
    }
  };

  // "hover" fires when pointer enters a new entity
  const onHover = (canvasCoords: any, hit: any) => {
    if (hit?.entity) {
      highlightEntity(hit.entity);
    }
  };

  // "hoverSurface" fires continuously while pointer moves over entity surface
  const onHoverSurface = (canvasCoords: any, hit: any) => {
    if (hit?.entity) {
      highlightEntity(hit.entity);
    }
  };

  // "hoverOut" fires when pointer leaves last entity
  const onHoverOut = () => {
    clearHighlight();
  };

  // "hoverOff" fires when pointer is over empty space
  const onHoverOff = () => {
    clearHighlight();
  };

  cameraControl.on('hover', onHover);
  cameraControl.on('hoverSurface', onHoverSurface);
  cameraControl.on('hoverOut', onHoverOut);
  cameraControl.on('hoverOff', onHoverOff);

  console.log('[AssetPlusViewer] Hover highlight active (4 events subscribed)');

  hoverListenerRef.current = () => {
    cameraControl.off('hover', onHover);
    cameraControl.off('hoverSurface', onHoverSurface);
    cameraControl.off('hoverOut', onHoverOut);
    cameraControl.off('hoverOff', onHoverOff);
    clearHighlight();
  };
}, []);
```

### Step 2: Fix X-ray Toggle (XrayToggle.tsx)

Use a dual approach -- try `setObjectsXRayed` first, fall back to iterating `scene.objects`:

```typescript
const handleToggleXray = useCallback((enabled: boolean) => {
  setXrayEnabled(enabled);
  const xeokitViewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  if (!xeokitViewer?.scene) {
    console.warn('[XrayToggle] Viewer not available');
    return;
  }

  const scene = xeokitViewer.scene;

  // Primary: batch API
  if (typeof scene.setObjectsXRayed === 'function') {
    const objectIds = scene.objectIds || [];
    scene.setObjectsXRayed(objectIds, enabled);
    console.log('[XrayToggle] setObjectsXRayed:', enabled, objectIds.length, 'objects');
  } else {
    // Fallback: iterate objects directly
    const objects = scene.objects || {};
    let count = 0;
    for (const id of Object.keys(objects)) {
      const entity = objects[id];
      if (entity && entity.isObject) {
        entity.xrayed = enabled;
        count++;
      }
    }
    console.log('[XrayToggle] Fallback xray on', count, 'entities');
  }
}, [viewerRef]);
```

Also fix the overflow menu X-ray active state detection in `ViewerToolbar.tsx`:

```typescript
active: (() => {
  const viewer = getXeokitViewer();
  if (!viewer?.scene) return false;
  // Check numXRayedObjects or iterate
  if (typeof viewer.scene.numXRayedObjects === 'number') {
    return viewer.scene.numXRayedObjects > 0;
  }
  // Fallback
  try {
    return (viewer.scene.xrayedObjectIds?.length || 0) > 0;
  } catch { return false; }
})()
```

### Step 3: Fix SDK Loading Gate (Ivion360View.tsx)

Change the SDK loading condition from requiring `syncEnabled` to only requiring `ivionUrl`:

```typescript
// Before (line 127):
if (!ivionUrl || !syncEnabled) {

// After:
if (!ivionUrl) {
```

This pre-loads the SDK whenever the Ivion URL is available, making it ready for sync when the user toggles sync on. The camera sync polling in `useIvionCameraSync` is already separately gated by the `enabled` prop.

## Files Changed

| File | Change |
|------|--------|
| `src/components/viewer/AssetPlusViewer.tsx` | Subscribe to all 4 hover events (hover, hoverSurface, hoverOut, hoverOff) |
| `src/components/viewer/XrayToggle.tsx` | Add fallback entity iteration for X-ray; better logging |
| `src/components/viewer/ViewerToolbar.tsx` | Fix X-ray active state detection in overflow menu |
| `src/components/viewer/Ivion360View.tsx` | Remove `syncEnabled` gate from SDK loading so it pre-loads |

## About the Uploaded Files

The uploaded files (styles.css, polyfills.js, runtime.js, main.js) are compiled Angular/webpack bundles from the AssetPlus viewer's internal build (DevExtreme 18.1.6). These are the source files that get compiled into `assetplusviewer.umd.min.js`. They are not directly relevant to the toolbar bugs since the toolbar is built in React and only calls into the AssetPlus viewer's API (`useTool()`, `cameraControl`, `scene`).

