

# Fix Three Issues: Floor Switcher Height, SDK Loading, and Opacity Slider

## Issue 1: Floor Switcher Still Too Tall

### Root Cause

The component at `FloatingFloorSwitcher.tsx` (lines 560-734) renders these elements vertically:
1. Drag handle (GripVertical icon) -- line 572-577
2. Layers icon with tooltip -- lines 580-590 (`h-6 w-6` wrapper)
3. Floor pills (5 max) -- lines 593-636 (`h-7 w-7 sm:h-8 sm:w-8` each)
4. Overflow button (if > 5 floors) -- lines 639-714
5. "Alla" (show all) button -- lines 718-733

The pills themselves are correctly sized, but the **Layers icon** and **drag handle** add significant height that doesn't scale with the number of floors. Additionally, the container's `gap-0.5` and `p-1` add padding that accumulates.

### Fix

1. **Remove the Layers icon entirely** (lines 579-590). The tooltip on the drag handle can explain the tool instead. This removes ~28px of wasted vertical space.
2. **Make the drag handle inline with the first pill** instead of a separate row. The GripVertical icon can sit at the top edge of the container as a thin strip.
3. **Reduce pill sizes** further: from `h-7 w-7 sm:h-8 sm:w-8` to `h-6 w-6 sm:h-7 sm:w-7`.
4. **Make the "Alla" button slimmer**: from `h-7` to `h-5`.
5. **Remove the gap between the drag handle and pills** by making the drag handle `h-4` with no vertical padding.

This will make the tool's height proportional to the number of floors shown.

## Issue 2: SDK Still Times Out

### Root Cause

The SDK loading flow calls `loadIvionSdk()` which:
1. Loads the `getApi` function via script tag (works - confirmed by logs)
2. Calls `getApi(cleanBaseUrl, config)` which returns a Promise
3. Races it against a 30-second timeout

The SDK initializes by finding the `<ivion>` custom element in the DOM. But looking at the flow in `Ivion360View.tsx` (used in split mode), there are TWO problems:

**Problem A: Race between element creation and `getApi()`**

In `Ivion360View.tsx` lines 152-197, the SDK loading creates the `<ivion>` element (line 174-177) and then calls `loadIvionSdk()` (line 180). However, `loadIvionSdk()` first loads the script (which takes time), and then calls `getApi()`. The `getApi()` function might look for `<ivion>` at script-load time (before the element exists) rather than at call time.

**Problem B: Conflicting `?site=` URL manipulation**

When the user navigates to `/split-viewer?building=X`, the URL already has query parameters. The `loadIvionSdk` function injects `?site=` into the URL (line 207-216 of ivion-sdk.ts). However, if `useIvionSdk` (for VT mode) ran first and already modified the URL, there could be stale state. The check `if (!currentUrl.searchParams.has('site'))` would skip injection if the URL already has `site` from a previous attempt.

**Problem C: Two SDK instances fighting**

When the user switches modes (e.g., starts in VT, SDK begins loading, switches to split), the `useIvionSdk` cleanup runs (sets `cancelled = true`, destroys the `<ivion>` element) while `Ivion360View` starts its own SDK loading. If the global `getApi` function (on `window`) is already initialized from the first attempt, the second call may reuse the same internal state, but the `<ivion>` element from the first attempt was destroyed. The SDK then can't find a valid render target.

### Fix

1. **In `Ivion360View.tsx`**: Ensure the `<ivion>` element is created BEFORE the script loads. Move element creation to `useEffect` mount (not inside `tryLoadSdk`), and use a `useRef` flag to track it.

2. **In `loadIvionSdk()`**: Add a DOM check before calling `getApi()`. Verify that at least one `<ivion>` element exists in the DOM with non-zero dimensions. If not, wait (poll) for up to 2 seconds before proceeding.

3. **Add a guard against multiple simultaneous SDK loads**: Use a module-level `Promise` variable to track any in-progress `getApi()` call. If one is already running, wait for it to complete (or fail) before starting another.

4. **Increase timeout to 45 seconds** for the initial load (the SDK fetches panorama data which can be slow on first load).

## Issue 3: Ghost Opacity Slider Not Working After First Load

### Root Cause

There are TWO opacity mechanisms that conflict:

**Mechanism A (UnifiedViewer, lines 228-247):** A `useEffect` that calls `xeokitViewer.scene.setObjectsOpacity(objectIds, ghostOpacity / 100)` whenever `ghostOpacity` changes. This works by finding the viewer instance via `viewerInstanceRef` or the global `window.__assetPlusViewerInstance`.

**Mechanism B (AssetPlusViewer, lines 1278-1293):** The `handleAllModelsLoaded` callback applies `ghostOpacity` once when all models finish loading. This is a prop-based approach.

The problem: When the user drags the slider, `ghostOpacity` changes in UnifiedViewer state, triggering Mechanism A. But Mechanism A has a guard: `if (viewMode === 'vt' && sdkStatus !== 'ready') return;`. When the SDK fails, `sdkStatus` is `'failed'`, and the user gets redirected to 3D mode. Even if they switch back to VT, if the SDK doesn't recover, the opacity effect never runs.

But the user says "it works the first time VT is activated." The first time, the opacity is set via Mechanism B (the prop `ghostOpacity={ghostOpacity / 100}` passed to AssetPlusViewer on line 499). This only runs on model load. After that, dragging the slider triggers Mechanism A, which is blocked by the SDK status check.

Additionally, the `useEffect` dependency array is `[ghostOpacity, sdkStatus, viewMode]` -- it doesn't include `viewerInstanceRef` because refs don't trigger re-renders. If the viewer instance loads AFTER the effect runs, the effect won't re-run when the viewer becomes available.

### Fix

1. **Remove the SDK status guard for VT mode opacity**: The 3D model opacity has nothing to do with the SDK status. The opacity slider should work regardless of whether the 360 SDK loaded.

2. **Add a viewer-ready flag**: Track when `viewerInstanceRef` becomes available and include it in the effect's dependency array, so the effect re-runs when the viewer is ready.

3. **Keep Mechanism A as the primary opacity control** (it's reactive to slider changes) and simplify Mechanism B to only handle the initial load default.

The fixed `useEffect`:
```typescript
useEffect(() => {
  if (viewMode !== 'vt' && viewMode !== 'split') return;
  
  let xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  if (!xeokitViewer) {
    const win = window as any;
    xeokitViewer = win.__assetPlusViewerInstance?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  }
  if (!xeokitViewer?.scene) return;
  try {
    const objectIds = xeokitViewer.scene.objectIds;
    if (objectIds?.length) {
      xeokitViewer.scene.setObjectsOpacity(objectIds, ghostOpacity / 100);
    }
  } catch (e) { console.debug('[UnifiedViewer] Ghost opacity error:', e); }
}, [ghostOpacity, viewMode]);
```

Key change: removed `sdkStatus` from the dependency array and the guard condition.

4. **Add a polling mechanism** to detect when the viewer instance becomes available:

```typescript
const [viewerReady, setViewerReady] = useState(false);

useEffect(() => {
  const checkForViewer = () => {
    const win = window as any;
    const instance = win.__assetPlusViewerInstance;
    if (instance) {
      viewerInstanceRef.current = instance;
      setViewerReady(true);
      return true;
    }
    return false;
  };
  const interval = setInterval(() => {
    if (checkForViewer()) clearInterval(interval);
  }, 500);
  return () => clearInterval(interval);
}, [buildingData]);
```

Then add `viewerReady` to the opacity effect's dependency array.

## Technical Details

### File: `src/components/viewer/FloatingFloorSwitcher.tsx`

1. Remove lines 579-590 (Layers icon tooltip wrapper)
2. Move tooltip content to the drag handle
3. Reduce pill button sizes from `h-7 w-7 sm:h-8 sm:w-8` to `h-6 w-6 sm:h-7 sm:w-7`
4. Reduce "Alla" button from `h-7` to `h-5`
5. Reduce drag handle height

### File: `src/pages/UnifiedViewer.tsx`

1. Lines 228-247: Remove `sdkStatus` from the ghost opacity effect's guard and dependency array
2. Lines 121-134: Add `viewerReady` state that triggers re-evaluation of opacity
3. Add `viewerReady` to the opacity effect dependency array

### File: `src/lib/ivion-sdk.ts`

1. Add a module-level guard against concurrent `getApi()` calls
2. Add a DOM element existence check before calling `getApi()`
3. Increase default timeout from 30000 to 45000

### File: `src/components/viewer/Ivion360View.tsx`

1. Create the `<ivion>` element on component mount (in a separate early useEffect), not inside the async SDK loading function
2. This ensures the element exists with dimensions before `getApi()` is called

## File Summary

| File | Changes |
|---|---|
| `src/components/viewer/FloatingFloorSwitcher.tsx` | Remove Layers icon, reduce pill/handle/button sizes, make height proportional to floor count |
| `src/pages/UnifiedViewer.tsx` | Fix ghost opacity effect: remove SDK status guard, add viewerReady state tracking |
| `src/lib/ivion-sdk.ts` | Add concurrent-load guard, DOM element check before getApi(), increase timeout |
| `src/components/viewer/Ivion360View.tsx` | Move ivion element creation to mount-time useEffect |

## Risk Assessment

- **Floor switcher compacting (no risk):** Pure CSS/layout changes, all functionality preserved.
- **Opacity fix (low risk):** Removing the SDK guard is safe because opacity has nothing to do with SDK state. Adding viewerReady ensures the effect runs at the right time.
- **SDK loading fixes (medium risk):** Adding a concurrent-load guard and DOM checks changes the initialization sequence. The guard prevents two SDK instances from fighting, but needs careful testing to ensure it doesn't block legitimate loads.

