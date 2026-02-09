
# Fix Virtual Twin: SDK Loading, Back Button, and Iframe Fallback

## Problem Summary

The Virtual Twin page cannot load the 360-degree panorama because the NavVis IVION SDK fails to load through all three methods. After this failure, the page becomes unresponsive because the back button is hidden behind a UI overlay.

## Root Cause Analysis

### Why the SDK fails to load

The SDK loading tries three methods in sequence, all fail:

1. **npm package** (`@navvis/ivion`): Not installed. The file `navvis-ivion-11.9.8.tgz` exists in the project root but is not listed in `package.json`.
2. **Direct script tag** (`swg.iv.navvis.com/ivion.js`): Blocked by CORS.
3. **CORS proxy** (`ivion-proxy/ivion.js`): The proxy fetches `https://swg.iv.navvis.com/ivion.js` which returns 404 - the file does not exist at that URL.

The standalone 360-view (Ivion360View) works because it gracefully falls back to an iframe when the SDK fails.

### Why the back button breaks

When SDK fails, `showFallback3D = true`, and AssetPlusViewer is rendered with `transparentBackground=false` and `pointerEvents: 'auto'`. On mobile, AssetPlusViewer renders its `MobileViewerOverlay` at z-index 30, which covers the Virtual Twin's own header at z-index 20. Since Virtual Twin does not pass an `onClose` prop to AssetPlusViewer, the mobile overlay's back button is also conditionally hidden (`{onClose && ...}`). Result: no back button is visible or clickable.

## Fix Plan

### Fix 1: Install the NavVis SDK npm package

Add `@navvis/ivion` to `package.json` using the local `.tgz` file. This enables Attempt 1 of the SDK loading chain, which loads the SDK from the bundled JavaScript (no CORS issues for the code itself).

| File | Change |
|---|---|
| `package.json` | Add `"@navvis/ivion": "file:./navvis-ivion-11.9.8.tgz"` to dependencies |

This is the approach documented in the existing type declarations file (`src/types/navvis-ivion.d.ts`, line 6-7).

### Fix 2: Suppress mobile overlay in Virtual Twin mode

Add a new prop `suppressOverlay` to AssetPlusViewer. When true, the MobileViewerOverlay and desktop toolbar are not rendered, allowing the parent (Virtual Twin) to control its own UI.

| File | Change |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | Add `suppressOverlay?: boolean` prop; skip MobileViewerOverlay and desktop toolbar when true |
| `src/pages/VirtualTwin.tsx` | Pass `suppressOverlay={true}` to AssetPlusViewer |

### Fix 3: Make the Virtual Twin header always accessible

Raise the Virtual Twin's header z-index above any child overlays, and ensure it is always rendered regardless of SDK or 3D viewer state.

| File | Change |
|---|---|
| `src/pages/VirtualTwin.tsx` | Change header from z-20 to z-40; ensure header renders unconditionally |

### Fix 4: Add iframe fallback for Virtual Twin

When the SDK fails to load, instead of showing only the 3D model, show the 360-degree panorama in a regular iframe. Since an iframe cannot be made transparent, the Virtual Twin will switch to a "tabbed" mode: the user can toggle between 3D view and 360 view using buttons. When the SDK loads successfully, the original transparent overlay mode is used.

| File | Change |
|---|---|
| `src/pages/VirtualTwin.tsx` | Add iframe fallback mode with 3D/360 toggle buttons when SDK fails |

```text
SDK succeeds:     Layer 1: Ivion SDK (bottom, receives events)
                  Layer 2: 3D transparent overlay (top, pointer-events: none)
                  --> Full Virtual Twin experience

SDK fails:        Tab A: 360 in iframe (full viewport)
                  Tab B: 3D viewer (full viewport)
                  --> Degraded but functional experience
```

### Fix 5: Improve error recovery

Add `navigate(-1)` as a reliable escape route. Currently the only way back is the header button which gets covered. Add a handler so that pressing the browser back button or the hardware back button on mobile always works.

| File | Change |
|---|---|
| `src/pages/VirtualTwin.tsx` | Ensure `navigate(-1)` is called on back button click even during error states; add `onClose` prop to AssetPlusViewer as additional safety |

## Complete File Summary

| File | Changes |
|---|---|
| `package.json` | Add `@navvis/ivion` dependency from local `.tgz` file |
| `src/components/viewer/AssetPlusViewer.tsx` | Add `suppressOverlay` prop to hide mobile/desktop UI when embedded in Virtual Twin |
| `src/pages/VirtualTwin.tsx` | (1) Pass `suppressOverlay` to AssetPlusViewer, (2) raise header z-index, (3) add iframe fallback with tab switcher, (4) pass `onClose` as safety |

## Technical Details

### npm package installation

The `navvis-ivion-11.9.8.tgz` file in the project root is the official NavVis IVION Frontend API SDK, distributed as a tarball. The type declarations in `src/types/navvis-ivion.d.ts` already reference this package and document the installation method:

```
"@navvis/ivion": "file:./navvis-ivion-11.9.8.tgz"
```

When installed, the `loadIvionSdk` function's Attempt 1 will succeed:
```typescript
const ivionModule = await import('@navvis/ivion');
getApi = ivionModule.getApi;
```

### Iframe fallback tab switcher

When SDK fails, the Virtual Twin page shows two tab buttons: "360" and "3D". The 360 tab shows the panorama in a standard iframe (same as Ivion360View uses). The 3D tab shows the AssetPlusViewer. Only one is visible at a time, but both stay mounted to preserve state.

### suppressOverlay prop

```typescript
// AssetPlusViewer.tsx
interface AssetPlusViewerProps {
  // ... existing props
  suppressOverlay?: boolean;
}

// In render:
{isMobile && state.isInitialized && !suppressOverlay && (
  <MobileViewerOverlay ... />
)}
{!isMobile && !suppressOverlay && (
  <div className="absolute top-2 ...">
    {/* Desktop toolbar */}
  </div>
)}
```

## Risk Assessment

- **npm package install**: Medium risk. The `.tgz` file exists but has never been installed as a dependency in this project. If the build system does not support `file:` dependencies, it will fail gracefully and fall back to Attempt 2 and 3 (which also fail, triggering the iframe fallback).
- **suppressOverlay**: Low risk. Simply skips rendering child overlays when a boolean prop is true. No behavioral changes to existing AssetPlusViewer usage.
- **Header z-index**: Low risk. Only affects the Virtual Twin page layout.
- **Iframe fallback**: Low risk. Reuses the same iframe approach that Ivion360View already uses successfully.
