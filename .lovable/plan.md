

# Fix Virtual Twin Performance and Alignment Workflow

## 1. VT Mode Extreme Slowness — Root Cause

The ghost opacity loop in `UnifiedViewer.tsx` (lines 182-210) calls `xv.scene.setObjectsOpacity(ids, ...)` on **every single animation frame** (~60fps), iterating ALL object IDs in the scene every time. This is an O(n) scene traversal per frame even when the opacity value hasn't changed. This is the primary cause of the severe performance degradation.

### Fix

Replace the continuous rAF loop with a **change-driven approach**: only call `setObjectsOpacity` when the `ghostOpacity` value actually changes, and once on initial mount. No polling loop needed.

```typescript
// BEFORE: runs every frame regardless
const loop = () => {
  xv.scene.setObjectsOpacity(ids, ghostOpacityRef.current / 100);
  requestAnimationFrame(loop);
};

// AFTER: runs only when opacity changes
useEffect(() => {
  if (viewMode !== 'vt') return;
  const xv = getViewer();
  if (!xv?.scene) return;
  const ids = xv.scene.objectIds;
  if (ids?.length) {
    xv.scene.setObjectsOpacity(ids, ghostOpacity / 100);
  }
}, [viewMode, ghostOpacity, viewerReady]);
```

This eliminates ~60 full scene traversals per second.

## 2. Alignment — Manual Database Values

The current alignment values for this building are:
- Offset X: -44.37m, Y: 0m, Z: 0m
- Rotation: 50 degrees

The AlignmentPanel UI already lets you adjust and save these values. If you know the correct values (e.g., from surveying or trial-and-error), you can also set them directly via the input fields in the panel -- each slider has a number input where you can type exact values.

No code changes needed for alignment -- the existing UI supports manual entry. The panel is accessible via the Move3D icon button in the VT/Split header toolbar.

## Files to Modify

| File | Changes |
|---|---|
| `src/pages/UnifiedViewer.tsx` | Replace continuous rAF opacity loop with change-driven useEffect (lines 178-210) |

## Risk Assessment

Low risk. The opacity is applied once when changed instead of 60 times per second. The visual result is identical.

