

## Fix: 2D Mode Initialization from Portfolio (Mobile) + FloatingFloorSwitcher Visibility

### Root Cause Analysis

**Problem 1 -- 2D never activates on mobile from Portfolio:**

The `VIEW_MODE_2D_TOGGLED_EVENT` is dispatched in `UnifiedViewerContent`'s useEffect immediately on mount (thanks to the sentinel logic). However, `ViewerToolbar` -- the component that *listens* for this event -- is only rendered when `state.isInitialized && initStep === 'ready'` (line 4230 of AssetPlusViewer). This means ViewerToolbar isn't even mounted when the event fires, so the event is lost entirely. The `pending2dRef` fallback only helps if ViewerToolbar is mounted but the xeokit scene isn't ready yet -- it doesn't help when the component itself doesn't exist yet.

**Problem 2 -- FloatingFloorSwitcher not visible on mobile:**

In `MobileUnifiedViewer`, the FloatingFloorSwitcher is conditionally rendered with `{viewMode === '2d' && ...}` (line 690). Since 2D mode never actually activates (Problem 1), the switcher never appears. Once Problem 1 is fixed, this should work.

### Solution

**File: `src/pages/UnifiedViewer.tsx`**

Re-dispatch the `VIEW_MODE_2D_TOGGLED_EVENT` when `viewerReady` becomes `true`, if the current `viewMode` is still `'2d'`. This ensures that ViewerToolbar (which is now mounted) receives the event:

```typescript
// After the existing viewerReady useEffect (line ~201-217), add:
useEffect(() => {
  if (viewerReady && viewMode === '2d') {
    // Re-dispatch so the now-mounted ViewerToolbar picks it up
    window.dispatchEvent(
      new CustomEvent(VIEW_MODE_2D_TOGGLED_EVENT, { detail: { enabled: true } })
    );
  }
}, [viewerReady, viewMode]);
```

This is a minimal, safe fix -- it only fires when the viewer is ready AND we're supposed to be in 2D mode. The existing `pending2dRef` logic in ViewerToolbar will also catch it as a secondary safety net.

### Files to Modify

| File | Change |
|---|---|
| `src/pages/UnifiedViewer.tsx` | Add a useEffect that re-dispatches `VIEW_MODE_2D_TOGGLED_EVENT` when `viewerReady` becomes true and `viewMode === '2d'` |

### What Already Works (No Changes Needed)

- FloatingFloorSwitcher in MobileUnifiedViewer -- already rendered for `viewMode === '2d'`, will appear once 2D activates
- ViewerToolbar's `pending2dRef` fallback -- provides additional safety
- Level labels toggle -- already disabled for 2D in the existing code
