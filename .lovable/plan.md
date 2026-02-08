

# Fix 3D Viewer: Navigation Bypass + Crash on Load

## Two Issues

### Issue 1: Skips building/view selector, jumps directly into 3D

**Root cause**: When the user navigates away from the 3D viewer by clicking another header button (e.g., Portfolio, Navigator), `viewer3dFmGuid` is **never cleared**. It stays set from the previous session. When the user later clicks the "3D Viewer" button in the header, `setActiveApp('assetplus_viewer')` is called, and `Viewer.tsx` sees the old `viewer3dFmGuid` is still set -- so it skips `BuildingSelector` and jumps straight into `AssetPlusViewer`.

**Fix**: Two changes:

1. **`AppHeader.tsx`**: When clicking the "3D Viewer" header button, clear `viewer3dFmGuid` first so the building selector always appears for fresh navigation.

2. **`Viewer.tsx`**: The line `setViewer3dFmGuid(null)` on line 64 is called **during render** (a React anti-pattern that can cause loops and double-renders). Move it into a `useEffect`.

### Issue 2: 3D crashes ("something loads but then crashes")

**Root cause**: Looking at `Viewer.tsx` line 62-70, there's a problematic render-time side effect:

```
if (viewer3dFmGuid && !isLoadingData && allData.length > 0 && !buildingFmGuid) {
    setViewer3dFmGuid(null); // <-- STATE UPDATE DURING RENDER!
    return <BuildingSelector />;
}
```

This calls `setViewer3dFmGuid(null)` during render, which triggers a re-render mid-render cycle. Combined with the fact that `setViewer3dFmGuid(null)` also changes `activeApp` (navigating away from the viewer), this creates a race condition: `AssetPlusViewer` may mount, begin initialization, then get torn down immediately by the app switch -- causing the crash.

Additionally, `Viewer.tsx` line 64 calls `setViewer3dFmGuid(null)` which calls `setActiveApp(previousAppBeforeViewer)`. Then the BuildingSelector is returned, but on the next render, the app has already switched away from the viewer. The user sees a brief flash or crash.

**Fix**: Remove the render-time state update. Handle invalid GUIDs properly using `useEffect` with a guard.

## Changes

### File 1: `src/components/layout/AppHeader.tsx`

In `handleMenuClick`, when the target app is `assetplus_viewer`, clear the previous viewer selection so the building selector is shown:

```typescript
const handleMenuClick = (app: string, mode?: string) => {
    if (isMobile && app === 'assetplus_viewer') {
        navigate('/viewer');
        return;
    }
    setSelectedFacility(null);
    // When navigating to 3D viewer via header, always show building selector
    if (app === 'assetplus_viewer') {
        setViewer3dFmGuid(null);
    }
    setActiveApp(app);
    if (mode) {
        setViewMode(mode);
    }
};
```

With React 18 automatic batching, `setViewer3dFmGuid(null)` and `setActiveApp('assetplus_viewer')` are batched into one render. The intermediate `setActiveApp(previousApp)` inside `setViewer3dFmGuid(null)` is overridden by the subsequent `setActiveApp('assetplus_viewer')`. Final state: `viewer3dFmGuid=null`, `activeApp='assetplus_viewer'`.

### File 2: `src/pages/Viewer.tsx`

Remove the render-time `setViewer3dFmGuid(null)` call and replace with a proper `useEffect`:

```typescript
// Replace the render-time side effect (lines 62-70)
// with a useEffect that handles invalid GUIDs

useEffect(() => {
    if (viewer3dFmGuid && !isLoadingData && allData.length > 0 && !buildingFmGuid) {
        // Invalid GUID - clear it
        setViewer3dFmGuid(null);
    }
}, [viewer3dFmGuid, isLoadingData, allData, buildingFmGuid, setViewer3dFmGuid]);
```

And in the render logic, simply show the BuildingSelector when there's no valid building (without calling state setters):

```typescript
// If GUID is set but we couldn't resolve a building, show selector
if (viewer3dFmGuid && !isLoadingData && allData.length > 0 && !buildingFmGuid) {
    return (
        <div className="h-full">
            <BuildingSelector />
        </div>
    );
}
```

### File Summary

| File | Change |
|---|---|
| `src/components/layout/AppHeader.tsx` | Clear `viewer3dFmGuid` when clicking the 3D Viewer header button |
| `src/pages/Viewer.tsx` | Move render-time state update to `useEffect`, fix race condition |

### Risk Assessment

Low risk. The header change only affects the explicit "click 3D Viewer button" flow. The `Viewer.tsx` fix removes a React anti-pattern (state update during render) that was causing unpredictable behavior. All other navigation paths (from Portfolio, Navigator, search results) are unchanged -- they still set `viewer3dFmGuid` and navigate to the viewer with the building pre-selected.

