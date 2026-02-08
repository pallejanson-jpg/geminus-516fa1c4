

# Fix 3D Viewer: iPhone Safe Area Overlap + Intermittent Crash

## Problem 1: Toolbar hidden behind iPhone browser chrome

On iPhone Safari, the browser has a dynamic address bar at the top and a bottom toolbar with navigation buttons. The 3D viewer's UI elements overlap with these:

- **Top**: The `MobileViewerOverlay` header (back button, building name, settings) uses `paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)'` -- this handles the notch/Dynamic Island but does NOT account for the Safari address bar, which sits below the safe area inset.
- **Bottom**: The `ViewerToolbar` uses `bottom: 'calc(env(safe-area-inset-bottom, 12px) + 12px)'` -- this only adds 12px above the safe area inset, which is not enough to clear the Safari bottom toolbar (approximately 44px tall).
- **Bottom**: The NavCube uses `bottom: 'calc(env(safe-area-inset-bottom, 12px) + 70px)'` -- same problem, offset from an insufficient base.

The root issue: `env(safe-area-inset-bottom)` on iPhone Safari reports around 34px for the home indicator, but the Safari toolbar buttons add another ~50px that is NOT part of the safe area. This means the ViewerToolbar with only 12px extra margin sits directly behind the Safari toolbar.

Similarly at the top, `env(safe-area-inset-top)` covers the notch/Dynamic Island but not the Safari address bar (~50px). With only 8px of padding, the header buttons are behind the address bar.

### Fix

Use `100dvh` (dynamic viewport height) for the viewer container instead of `100vh`/`h-screen`. The `dvh` unit automatically excludes browser chrome (address bar + bottom toolbar) on mobile Safari. Then increase the padding values for the top header and bottom toolbar to account for the remaining UI spacing:

**Files to change:**

1. **`src/pages/Mobile3DViewer.tsx`**: Change the outer container from `h-screen` to use `100dvh` so the viewer fills only the visible area (excluding browser chrome).

2. **`src/components/viewer/ViewerToolbar.tsx`** (mobile section, line 748): Increase the bottom offset from `12px` to `16px` to give more breathing room above the Safari bottom indicator.

3. **`src/components/viewer/mobile/MobileViewerOverlay.tsx`** (line 130): Increase the top padding from `8px` to `12px` for better clearance below the address bar area.

4. **`src/components/viewer/AssetPlusViewer.tsx`** (NavCube, line 2971): Adjust NavCube bottom offset to stay consistent with the toolbar.

5. **`src/components/viewer/MobileViewerOverlay.tsx`** -- the building selector in Mobile3DViewer also uses `h-screen`, change to `h-dvh`.

The key insight is that `100dvh` does the heavy lifting. On iPhone Safari, `100vh` equals the full screen height including browser chrome, but `100dvh` equals only the visible area. By constraining the viewer to `100dvh`, the toolbar positioned at `bottom: calc(env(safe-area-inset-bottom) + 16px)` will be comfortably above the Safari toolbar.

## Problem 2: Intermittent 3D crash during loading

After the previous fixes (ref-based stabilization, parameter order fix), the main remaining crash vector is the `initializeViewer` dependency on `handleAllModelsLoaded`. Looking at the dependency chain:

- `handleAllModelsLoaded` depends on `executeDisplayAction`, `transparentBackground`, `ghostOpacity`
- `executeDisplayAction` is another callback

If `executeDisplayAction` changes identity, `handleAllModelsLoaded` changes identity, which changes `initializeViewer` identity, triggering the cleanup+re-init cycle during loading.

Additionally, `changeXrayMaterial` and `processDeferred` and `displayFmGuid` are also in the dependency array. If any of these change identity during the async initialization window, the viewer gets torn down mid-load.

### Fix

Apply the same ref-based pattern to stabilize the remaining volatile callbacks:

1. Add refs for `handleAllModelsLoaded`, `changeXrayMaterial`, `processDeferred`, `displayFmGuid`, and `setupCacheInterceptor`.
2. Keep them in sync with useEffect.
3. Update `initializeViewer` to call from refs instead of closure variables.
4. Remove them from the dependency array, leaving only `[fmGuid, initialFmGuidToFocus, isMobile]`.

This ensures the viewer ONLY re-initializes when the user navigates to a different building or the mobile state changes -- never due to callback identity changes.

## File Summary

| File | Changes |
|---|---|
| `src/pages/Mobile3DViewer.tsx` | Change `h-screen` to `h-dvh` on viewer container and building selector |
| `src/components/viewer/ViewerToolbar.tsx` | Increase mobile bottom offset for Safari toolbar clearance |
| `src/components/viewer/mobile/MobileViewerOverlay.tsx` | Increase top padding for Safari address bar clearance |
| `src/components/viewer/AssetPlusViewer.tsx` | (1) Adjust NavCube bottom offset, (2) Stabilize all remaining callback dependencies with refs |

## Technical Details

### dvh vs vh on iPhone Safari

```text
100vh  = Full screen including address bar + bottom toolbar
100dvh = Current visible viewport (shrinks when bars are visible)
100svh = Smallest possible viewport (bars visible)
100lvh = Largest possible viewport (bars hidden)
```

Using `100dvh` is the modern standard for fullscreen mobile views. It is supported in Safari 15.4+ (iOS 15.4+, March 2022), covering all actively used iPhones.

### Stabilized initializeViewer dependency array

Changes from:
```
[fmGuid, initialFmGuidToFocus, handleAllModelsLoaded,
 changeXrayMaterial, processDeferred, displayFmGuid,
 setupCacheInterceptor, isMobile]
```
To:
```
[fmGuid, initialFmGuidToFocus, isMobile]
```

All callbacks are accessed via refs inside the function body, which always point to the latest version without causing re-initialization.

### Risk Assessment

Low risk.
- `dvh` units are well-supported on modern iOS Safari (15.4+).
- The ref-based callback pattern is identical to what was already applied for `cacheStatus`, `showNavCube`, `assetData`, and `allData`.
- No behavioral changes -- only stability improvements and positioning fixes.

