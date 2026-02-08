

# Fix 3D Viewer Model Loading Regression

## Problem

The 3D viewer container mounts and initializes (token + config fetched, Asset+ viewer mounted), but no XKT models render. The runtime error confirms:

```
undefined is not an object (evaluating 'this.assetViewer.setAvailableModelsByFmGuid')
```

This means the Asset+ viewer's internal `assetViewer` reference is `null` when `setAvailableModelsByFmGuid` is called. The viewer was either destroyed mid-setup or not fully initialized before model requests began.

## Root Cause

The `initializeViewer` function (line 2662) has `assetData` and `allData` in its dependency array:

```text
[fmGuid, initialFmGuidToFocus, assetData, allData,
 handleAllModelsLoaded, changeXrayMaterial, processDeferred,
 displayFmGuid, setupCacheInterceptor, isMobile]
```

`assetData` is derived from `allData` on every render (line 273):
```
const assetData = allData.find((a) => a.fmGuid === fmGuid);
```

When `allData` updates (which happens during background data refresh, XKT sync status changes, or any AppContext update), `initializeViewer` gets a new identity. The `useEffect` (line 2698-2761) re-runs:

1. Cleanup runs first: calls `viewer.clearData()`, sets `viewerInstanceRef.current = null`
2. New `initializeViewer()` starts from scratch
3. During the gap between cleanup and re-init, the old viewer's `assetViewer` internal reference is gone
4. If any pending operation (like `setAvailableModelsByFmGuid`) tries to execute on the destroyed instance, the crash occurs

On mobile, slower initialization makes this window much larger, so it happens consistently.

The previous fix stabilized `handleAllModelsLoaded` by removing `cacheStatus` and `showNavCube` from its deps (using refs). But `assetData` and `allData` were NOT addressed -- they remain volatile dependencies that trigger re-initialization.

## Fix

Apply the same ref-based pattern to `assetData` and `allData` inside `initializeViewer`, and remove them from the dependency array.

### Changes to `src/components/viewer/AssetPlusViewer.tsx`:

1. **Add refs for `assetData` and `allData`**:
   - `const assetDataRef = useRef(assetData)`
   - `const allDataRef = useRef(allData)`
   - Keep in sync with `useEffect(() => { assetDataRef.current = assetData }, [assetData])`
   - Keep in sync with `useEffect(() => { allDataRef.current = allData }, [allData])`

2. **Update `initializeViewer`** to read from refs instead of closure variables:
   - Replace `assetData` references inside the function body with `assetDataRef.current`
   - Replace `allData` references inside the function body with `allDataRef.current`
   - Remove `assetData` and `allData` from the dependency array

3. **Result**: `initializeViewer` only re-creates when `fmGuid` or `initialFmGuidToFocus` changes (actual navigation), not when background data refreshes.

### File Summary

| File | Changes |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | Add `assetDataRef` and `allDataRef` refs, update `initializeViewer` to use refs, remove `assetData` and `allData` from dependency array |

### Technical Details

The dependency array for `initializeViewer` changes from:
```
[fmGuid, initialFmGuidToFocus, assetData, allData,
 handleAllModelsLoaded, changeXrayMaterial, processDeferred,
 displayFmGuid, setupCacheInterceptor, isMobile]
```
to:
```
[fmGuid, initialFmGuidToFocus,
 handleAllModelsLoaded, changeXrayMaterial, processDeferred,
 displayFmGuid, setupCacheInterceptor, isMobile]
```

The `assetData` variable is used inside `initializeViewer` at lines 2595, 2635-2637 for:
- Finding focus data in `allData` (line 2595): `allData.find((a) => a.fmGuid === focusFmGuid)` -- will use `allDataRef.current`
- Setting model info name (lines 2635-2637): `assetData?.commonName` -- will use `assetDataRef.current`

Both are read-once values that should use the latest snapshot at call time, which refs provide perfectly.

### Risk Assessment

Low risk. The ref pattern is identical to what was already applied for `cacheStatus` and `showNavCube`. The runtime behavior is unchanged -- the only difference is that background `allData` updates no longer trigger a full viewer teardown and re-initialization. The viewer still initializes correctly on first mount and when the user navigates to a different building (`fmGuid` changes).

