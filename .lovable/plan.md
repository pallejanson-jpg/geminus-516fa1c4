

# Fix 4 Issues in UnifiedViewer / Split Screen

## Issue 1: Ivion SDK times out (both useIvionSdk and Ivion360View)

### Root Cause

The console logs show TWO parallel SDK loading attempts:
1. `useIvionSdk` (from UnifiedViewer line 89) -- used for VT and 360 modes
2. `Ivion360View` internal SDK loading (its own `useEffect` at line 131) -- used for split mode

Both try to call `loadIvionSdk()` which injects `?site=` into `window.location` via `replaceState`. But the SDK container in `Ivion360View` has `display: none` during loading (line 555):

```
style={{ display: renderMode === 'sdk' ? 'block' : 'none' }}
```

Since `renderMode` is `'iframe'` until SDK is ready, the container is hidden during initialization. The SDK needs a visible container with real dimensions to initialize WebGL. This is the same chicken-and-egg problem identified earlier.

Additionally, the URL has `?site=3373717251911143` already present (from the user's current route), but the `loadIvionSdk` function checks `if (!currentUrl.searchParams.has('site'))` and skips injection since it's already there. This should work, BUT the SDK initialization still times out because of the hidden container.

### Fix

In `Ivion360View.tsx` line 555, change:
```
display: renderMode === 'sdk' ? 'block' : 'none'
```
to:
```
display: sdkStatus === 'failed' ? 'none' : 'block'
```

This ensures the SDK container is visible during the loading phase (the loading spinner overlay covers it visually anyway). Only hide it when SDK definitively fails and we need to show the iframe.

Also change the iframe mount condition (line 559) from:
```
{renderMode === 'iframe' && (
```
to:
```
{sdkStatus === 'failed' && (
```

This prevents the iframe from mounting and competing with the SDK during loading.

## Issue 2: Header toolbar overlaps Ivion and 3D content

### Root Cause

The header toolbar in UnifiedViewer (line 395) uses `absolute top-0` with `z-40`. It overlays on top of the content areas. In split mode, the content area has `top: '48px'` (line 357) to try to accommodate this, but the header is transparent (`bg-black/40`) and still visually covers Ivion's own toolbar and 3D viewer's controls.

The Ivion360View component also renders its own toolbar (line 430) which gets hidden under the UnifiedViewer header.

### Fix

Change the header from `absolute` positioning to a proper document-flow element that pushes content down:

1. Change the root layout from `relative` to a flex column layout
2. Make the header a non-absolute `shrink-0` element
3. Make the content area fill the remaining space with `flex-1 min-h-0`
4. Remove the hardcoded `top: '48px'` from the split view container

Before:
```
<div className="h-screen w-screen relative overflow-hidden bg-black">
  {/* Content areas with absolute inset-0 */}
  <div className="absolute top-0 ... z-40"> {/* Header */}
```

After:
```
<div className="h-screen w-screen flex flex-col overflow-hidden bg-black">
  <div className="shrink-0 flex items-center ... z-40"> {/* Header - in flow */}
  <div className="flex-1 min-h-0 relative"> {/* Content area */}
    {/* Mode-specific content with absolute inset-0 */}
```

## Issue 3: Floor switcher is too tall

### Root Cause

The floor switcher renders a drag handle, a Layers icon, 5 floor pills, possibly an overflow button, and a "Visa alla" button. Even with `MAX_VISIBLE_PILLS_DESKTOP = 5`, the total vertical height includes padding, gaps, and the extra UI elements. The component has a fixed pill size of `h-8 w-8` or `h-9 w-9` on desktop, plus `gap-1` and `p-1.5` padding.

The user says the tool's length is "double the height of the number of floors shown" -- this suggests the container has extra empty space, likely from the drag handle area, the Layers icon, and generous padding.

### Fix

1. Reduce padding from `p-1.5 sm:p-2` to `p-1`
2. Reduce gap from `gap-1` to `gap-0.5`
3. Make the drag handle more compact (reduce `py-0.5` to `py-0`)
4. Make the Layers icon smaller (reduce from `h-7 w-7` / `h-8 w-8` to `h-6 w-6`)
5. Make pill buttons slightly smaller: from `h-8 w-8 sm:h-9 sm:w-9` to `h-7 w-7 sm:h-8 sm:w-8`

## Issue 4: 3D model visibility slider not working properly

### Root Cause

In UnifiedViewer, the ghost opacity slider (line 228-239) reads the xeokit viewer instance and calls `setObjectsOpacity()`. However, the ghost opacity slider is only shown in VT mode (line 507: `{viewMode === 'vt' && ...}`).

In Split mode, there is no opacity slider at all. If the user is talking about split mode, there is simply no slider available.

The slider code also depends on `viewerInstanceRef.current` which is populated by polling `window.__assetPlusViewerInstance` (line 122-134). This might not find the viewer if AssetPlusViewer doesn't expose itself on that global.

Looking at the ghost opacity code more carefully:
```typescript
const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
```

This traverses Vue component refs (`$refs`), which is correct for the Asset+ viewer (it's a Vue component wrapped in React). The issue might be that the viewer ref chain is stale or the global isn't being set.

### Fix

1. In UnifiedViewer, also show the ghost opacity slider in split mode (not just VT), so users can control 3D model transparency in both modes
2. Add a fallback mechanism: if `viewerInstanceRef` is not populated via the global, try to get it from the AssetPlusViewer DOM container directly

## Technical Details

### File: `src/components/viewer/Ivion360View.tsx`

SDK container visibility fix (line 555):
```
// Before
style={{ display: renderMode === 'sdk' ? 'block' : 'none' }}
// After
style={{ display: sdkStatus === 'failed' ? 'none' : 'block' }}
```

Iframe mount condition (line 559):
```
// Before
{renderMode === 'iframe' && (
// After
{sdkStatus === 'failed' && (
```

### File: `src/pages/UnifiedViewer.tsx`

Layout restructure (lines 311-395):
```
// Before: absolute positioning
<div className="h-screen w-screen relative overflow-hidden bg-black">
  <div ref={sdkContainerRef} className="absolute inset-0 z-0" ... />
  {viewMode === '3d' && <div className="absolute inset-0 z-10"> ... </div>}
  {viewMode === 'split' && <div className="absolute inset-0 z-10" style={{ top: '48px' }}> ... </div>}
  <div className="absolute top-0 left-0 right-0 z-40 ..."> ... </div>

// After: flex column layout
<div className="h-screen w-screen flex flex-col overflow-hidden bg-black">
  {/* Header - in document flow */}
  <div className="shrink-0 flex items-center justify-between p-2 bg-black/80 backdrop-blur-sm z-40"> ... </div>
  {/* Content area */}
  <div className="flex-1 min-h-0 relative">
    <div ref={sdkContainerRef} className="absolute inset-0 z-0" ... />
    {viewMode === '3d' && <div className="absolute inset-0 z-10"> ... </div>}
    {viewMode === 'split' && <div className="absolute inset-0 z-10"> ... </div>}  // No top offset
    ...
  </div>
</div>
```

Alignment panel position update: change `top-14` to `top-2` since the header is now outside the content area.

### File: `src/components/viewer/FloatingFloorSwitcher.tsx`

Compact the component (lines 560-577):
- Container: `gap-1 p-1.5 sm:p-2` to `gap-0.5 p-1`
- Drag handle: `py-0.5` to `py-0`, icon `h-3.5 w-3.5` to `h-3 w-3`
- Layers icon wrapper: `h-7 w-7 sm:h-8 sm:w-8` to `h-6 w-6`
- Pill buttons: `h-8 w-8 sm:h-9 sm:w-9` to `h-7 w-7 sm:h-8 sm:w-8`

## File Summary

| File | Changes |
|---|---|
| `src/components/viewer/Ivion360View.tsx` | Fix SDK container visibility: show during loading, hide only on failure. Delay iframe mount until SDK fails. |
| `src/pages/UnifiedViewer.tsx` | Restructure layout from absolute to flex column so header pushes content down instead of overlapping. Move alignment panel offset. |
| `src/components/viewer/FloatingFloorSwitcher.tsx` | Reduce padding, gaps, and element sizes to make the component more compact vertically. |

## Risk Assessment

- **SDK container visibility (low risk):** The loading spinner overlay (z-10) already covers the SDK container visually, so users see the same loading state. The SDK just gets a visible container to initialize WebGL in.
- **Layout restructure (medium risk):** Changing from absolute to flex column affects all four view modes. The content area's `relative` wrapper with `flex-1 min-h-0` ensures the absolute-positioned children (SDK, 3D, etc.) still fill the available space correctly. Need to verify that VT mode's layered rendering still works within the new flex child.
- **Floor switcher compacting (no risk):** Pure CSS size changes. All functionality unchanged.
- **Iframe delayed mount (low risk):** Same behavior as before, just delayed until SDK confirms failure.

