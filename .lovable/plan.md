

# Plan: Cesium sidebar parity, camera restore, viewer back-button, BIM XKT→GLB conversion

## Issues to fix

1. **Cesium sidebar shows fewer buildings than MapView** — Cesium only lists buildings with coordinates in `building_settings`. MapView uses `navigatorTreeData` with fallback to Nordic cities for buildings without saved coords. Need same approach in Cesium.

2. **Sidebar labels differ** — MapView shows address line under building name. Cesium only shows `displayName`. Match the MapView style including address.

3. **Returning from "Visa detaljer" resets Cesium to Nordic view** — Camera state is lost. Save camera position before navigating away, restore it when returning to globe.

4. **No back button in 3D viewer to return to Cesium** — `NativeViewerShell` has `onClose` prop but no desktop back button. The `onClose` already handles sessionStorage return-app. Need to add a visible back/close button in the toolbar area.

5. **BIM conversion fails: "XKT exists but no convertible source translation"** — The `bim-to-gltf` edge function requires ACC translation when no IFC exists. Most buildings only have XKT files (no IFC, no ACC). Need to add direct XKT→GLB conversion: download XKT, parse with `@xeokit/xeokit-convert`, extract geometry, build GLB.

## Changes

### 1. CesiumGlobeView.tsx — Sidebar parity with MapView

- Change `facilities` to use `navigatorTreeData` as primary source (like MapView), with `buildingCoords` as coordinate lookup
- For buildings without saved coords, fall back to Nordic cities (same as MapView lines 250-268)
- Add `address` field to facility data
- Show address in sidebar items under the building name
- Include `allData` from AppContext to calculate storey/space counts for sidebar display

### 2. CesiumGlobeView.tsx — Save/restore camera on navigation

- Before `handleNavigateToFacility` and `handleOpenViewer`, save camera state (`eye`, `look`, `up`, `zoomedFmGuid`, `selectedFmGuid`) to `sessionStorage`
- On component mount, check sessionStorage for saved camera state. If found, restore camera position instead of doing the fly-in animation
- Key: `cesium-camera-state`

### 3. NativeViewerShell.tsx — Add desktop back button

- Add an `ArrowLeft` button in the top-left corner of the viewer (outside the toolbar) that calls `onClose()`
- Style: small rounded button with `bg-card/80 backdrop-blur-sm`, similar to the mobile overlay's back button but positioned for desktop

### 4. bim-to-gltf edge function — XKT→GLB direct conversion

When no IFC and no ACC translation exists but XKT files are found:
- Download the A-model XKT file from storage
- Parse it with `@xeokit/xeokit-convert` to extract geometry data
- Build GLB from extracted vertices/indices using existing `buildGlb()` function
- Cache and return signed URL

This eliminates the 422 error for XKT-only buildings.

## Files changed

| File | Change |
|------|--------|
| `src/components/globe/CesiumGlobeView.tsx` | Sidebar uses all buildings from navigatorTreeData, shows address, saves/restores camera |
| `src/components/viewer/NativeViewerShell.tsx` | Add desktop back button |
| `supabase/functions/bim-to-gltf/index.ts` | Add XKT→GLB conversion fallback path |

