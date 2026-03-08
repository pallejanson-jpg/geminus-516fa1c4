

# Root Cause Analysis & Fix Plan: 2D Mode and Split View

## What I Found (Live Runtime Testing)

### Split 2D/3D: Actually works (partially)
- StoreyViewsPlugin initializes successfully with 23 storeys
- Map image generates (93KB) and renders on white background
- The plan image shows the building correctly
- **Status**: Working, but slow to initialize (~45 sec total)

### Pure 2D Mode: Blank white screen
I switched to 2D mode on mobile and saw a completely empty white/gray screen with only the floor switcher and toolbar visible. The canvas is there but shows nothing.

**Root cause identified**: The 2D mode styling in `ViewerToolbar.tsx` (lines 607-661) iterates over `scene.metaScene.metaObjects` to color walls/doors/furniture. But xeokit's `metaScene` is accessed from `scene.metaScene` which is incorrect -- it should be `viewer.metaScene`. The code at line 612 does:

```typescript
const metaObjects = scene?.metaScene?.metaObjects || {};
```

In native xeokit, `metaScene` lives on the **viewer**, not the scene. `scene.metaScene` is undefined, so the entire loop over metaObjects produces zero iterations. The `visibleCount` stays at 0, triggering the safety rollback -- which restores original colors but doesn't undo the section plane clipping or white background. Result: white screen with clipped geometry but no 2D styling applied.

Additionally, even if metaObjects were found, the code only handles a few IFC types (walls, doors, windows, furniture, spaces, slabs). Any object that doesn't match these types (beams, columns, stairs, railings, etc.) is left unchanged -- potentially invisible or oddly styled.

## Plan

### 1. Fix metaScene access in ViewerToolbar 2D mode (critical)
In `ViewerToolbar.tsx` line 612, change:
```typescript
const metaObjects = scene?.metaScene?.metaObjects || {};
```
to:
```typescript
const metaObjects = viewer?.metaScene?.metaObjects || scene?.metaScene?.metaObjects || {};
```

This single fix should make 2D mode work because all the wall/door/window styling will actually execute.

### 2. Handle unmatched IFC types in 2D mode
Add a catch-all else clause after the specific type checks: any visible object not matching a known type should still be styled (e.g., dark edges, moderate opacity) and remain pickable. This prevents "orphan" objects from showing as bright red/uncolored.

### 3. Add metaScene fallback in useSectionPlaneClipping
In `useSectionPlaneClipping.ts` line 169-175, add `window.__nativeXeokitViewer` as fallback:
```typescript
const getXeokitViewer = useCallback(() => {
  try {
    const v = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (v?.scene) return v;
    return (window as any).__nativeXeokitViewer || null;
  } catch { return null; }
}, [viewerRef]);
```

### 4. Reduce SplitPlanView init delay
Currently the StoreyViewsPlugin takes ~45 seconds to init because:
- It waits for `__xeokitSdk` (set after SDK loads in NativeXeokitViewer)
- Then waits for metaObjects to contain IfcBuildingStorey
- Retries every 500ms up to 60 times

Optimize by listening directly for `VIEWER_MODELS_LOADED` event instead of polling. Also reduce the fallback snapshot timer from 15s to 8s.

## Files to Edit
1. `src/components/viewer/ViewerToolbar.tsx` -- fix metaScene access, add catch-all styling
2. `src/hooks/useSectionPlaneClipping.ts` -- add global viewer fallback
3. `src/components/viewer/SplitPlanView.tsx` -- reduce init delay

## Expected Result
- **2D mode**: Walls appear dark, doors/windows visible, furniture visible, objects clickable. No blank screen.
- **Split 2D/3D**: Continues working, but loads faster.
- **3D mode**: Unchanged.

