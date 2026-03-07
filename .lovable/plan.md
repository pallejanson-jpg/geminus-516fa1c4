

# Plan: Proper 2D Split View Using xeokit StoreyViewsPlugin

## Problem
The split 2D/3D mode currently uses `SplitPlanView`, a custom canvas that manually draws room/wall AABBs — resulting in a crude, ugly representation. Meanwhile, xeokit's built-in **`StoreyViewsPlugin`** can generate proper orthographic 2D plan images with `createStoreyMap()` and support click-to-navigate with `pickStoreyMap()`. This is the industry-standard approach.

## Solution

Replace `SplitPlanView`'s custom canvas rendering with xeokit's `StoreyViewsPlugin.createStoreyMap()` for the 2D panel in split mode. This produces a high-quality rendered plan image directly from the BIM model — identical to what Dalux and other professional viewers use.

### Architecture

```text
┌──────────────────────────────────────────────┐
│  Desktop Split 2D/3D                         │
│  ┌─────────────────┬─────────────────────┐   │
│  │ StoreyMap image  │                     │   │
│  │ (from xeokit     │   NativeViewerShell │   │
│  │  createStoreyMap)│   (3D)              │   │
│  │                  │                     │   │
│  │ Click → pickSto- │                     │   │
│  │ reyMap → flyTo   │                     │   │
│  │                  │                     │   │
│  │ Camera dot       │                     │   │
│  │ overlay          │                     │   │
│  └─────────────────┴─────────────────────┘   │
│                                              │
│  Mobile: Same but vertical stack             │
└──────────────────────────────────────────────┘
```

### Changes

#### 1. Rewrite `SplitPlanView.tsx` to use `StoreyViewsPlugin`
- On mount, get the shared xeokit viewer from `window.__nativeXeokitViewer`
- Create a `StoreyViewsPlugin` instance
- Get current storey ID from metaScene (listen for `FLOOR_SELECTION_CHANGED_EVENT`)
- Call `storeyViewsPlugin.createStoreyMap(storeyId, { width, format: 'png', useObjectStates: true })` to generate the plan image
- Display the image in an `<img>` tag with CSS `object-contain`
- On click: use `storeyViewsPlugin.pickStoreyMap(storeyMap, canvasPos)` to get the picked entity + world position, then `cameraFlight.flyTo()` to navigate the 3D view
- Overlay a camera position indicator (small dot + direction line) using absolute-positioned CSS, calculated from camera world coords → image coords using the storeyMap's coordinate mapping
- Re-generate the map when floor changes or viewer scene updates
- Support pan/zoom via CSS `transform: scale() translate()` on the image container
- Add touch support for mobile (pinch-zoom, drag-pan)

#### 2. Update `MinimapPanel.tsx` to use StoreyViewsPlugin too
- Same approach as SplitPlanView but smaller — replace the crude canvas drawing with `createStoreyMap()`
- This gives consistent, high-quality plan images in both the minimap and split view
- Translate remaining Swedish strings ("Översikt" → "Overview", "Laddar karta..." → "Loading map...")

#### 3. Desktop split layout (no change needed)
The existing `ResizablePanelGroup` in `UnifiedViewer.tsx` is fine — just the content of the left panel (SplitPlanView) gets upgraded.

#### 4. Mobile split layout (no change needed)
The vertical stack layout is correct — just the SplitPlanView content gets upgraded.

### Key xeokit API Usage

```typescript
// Import from the SDK (already loaded)
const sdk = await import('/lib/xeokit/xeokit-sdk.es.js');
const { StoreyViewsPlugin } = sdk;

// Create plugin (once per viewer lifecycle)
const storeyViewsPlugin = new StoreyViewsPlugin(viewer);

// Get available storey IDs
const storeyIds = Object.keys(storeyViewsPlugin.storeys);

// Generate plan image for a storey
const storeyMap = storeyViewsPlugin.createStoreyMap(storeyId, {
  width: containerWidth * devicePixelRatio,
  format: 'png',
  useObjectStates: true  // respects current visibility/coloring
});
// storeyMap.imageData = base64 PNG
// storeyMap.width, storeyMap.height

// Click navigation
const pickResult = storeyViewsPlugin.pickStoreyMap(storeyMap, [mouseX, mouseY]);
if (pickResult?.worldPos) {
  viewer.cameraFlight.flyTo({
    eye: [pickResult.worldPos[0], viewer.camera.eye[1], pickResult.worldPos[2]],
    look: pickResult.worldPos,
    duration: 0.8
  });
}
```

### Coordinate mapping for camera overlay
The StoreyMap has a known world-space extent that corresponds to the image pixels. We compute:
```
imageX = (camera.eye[0] - storeyMap.aabb[0]) / (storeyMap.aabb[3] - storeyMap.aabb[0]) * imageWidth
imageY = (camera.eye[2] - storeyMap.aabb[2]) / (storeyMap.aabb[5] - storeyMap.aabb[2]) * imageHeight
```

### Files to modify

| File | Change |
|------|--------|
| `src/components/viewer/SplitPlanView.tsx` | Full rewrite: use StoreyViewsPlugin instead of manual canvas |
| `src/components/viewer/MinimapPanel.tsx` | Rewrite to use StoreyViewsPlugin, translate Swedish → English |

### What stays the same
- `UnifiedViewer.tsx` layout (ResizablePanelGroup desktop, vertical stack mobile) — no changes
- `NativeViewerShell.tsx` — no changes
- Click-to-navigate, camera sync, floor switching events — same API, better implementation

