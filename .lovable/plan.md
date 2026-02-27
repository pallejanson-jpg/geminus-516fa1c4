

# Analysis: Cesium Globe, Build Error, and Map Coordinate Systems

## 1. Build Error (blocking everything)

The build error message says "dev server state is error" but the actual runtime error is React #31 from `assetplusviewer.umd.min.js` -- this is in the Asset+ Vue wrapper, not related to our changes. The build itself compiles. This is a pre-existing runtime error in the legacy viewer, not a new regression.

## 2. Cesium Globe Analysis

The CesiumGlobeView component at `src/components/globe/CesiumGlobeView.tsx` has these potential issues:

- **Token fetch**: It calls `get-cesium-token` edge function. If `CESIUM_ION_TOKEN` secret is not set, it falls back to a hardcoded demo token that is almost certainly expired/invalid.
- **Resium + @cesium/engine bundling**: The component imports `resium` and `@cesium/engine` directly. These are heavy WebGL/WASM packages. The vite config has no special handling for Cesium assets (CSS, workers, static assets like `Assets/`, `Workers/`). Cesium requires these to be served from a specific base URL. Without a Vite plugin like `vite-plugin-cesium` or manual `CESIUM_BASE_URL` configuration, the globe will fail silently.
- **Missing Cesium CSS**: No import of Cesium's widget CSS.
- **No CESIUM_BASE_URL**: `@cesium/engine` needs `window.CESIUM_BASE_URL` set to the path where Cesium's static assets are served from. This is not configured.

**Root cause**: The Cesium globe likely crashes on init because it can't find its static assets (Workers, Assets). The component is lazy-loaded so the crash is silent unless you navigate to `globe`.

## 3. Map Coordinate Comparison

The app has two map views that display buildings:

### Mapbox Map (`MapView.tsx`)
- Uses **lat/lng** from `building_settings` table
- Falls back to random Nordic cities if no coordinates saved
- Buildings shown as 2D markers/clusters
- No 3D model placement -- just icons/pins

### Cesium Globe (`CesiumGlobeView.tsx`)
- Uses **lat/lng** from `building_settings` table (same source)
- Buildings shown as pins with labels
- Has optional OSM 3D buildings toggle (generic, not your BIM models)
- No actual BIM model placement on the globe currently

### Key difference: "Placing 3D models on the map"
- **Mapbox**: Cannot render 3D BIM models natively. Would need Mapbox GL's `addLayer` with custom 3D data (glTF), which is complex and limited.
- **Cesium**: Can render actual 3D models via `Cesium3DTileset` or `glTF/glb` entities. The existing `xkt-to-gltf` pipeline (mentioned in memory) could convert cached XKT models to glTF for Cesium placement. Requires proper georeferencing (origin_lat, origin_lng, rotation from `building_settings`).

Both maps use the **same coordinate format** (WGS84 lat/lng from `building_settings`). No format difference for pin placement.

## Proposed Plan

### Step 1: Fix Cesium Globe startup
- Add `vite-plugin-cesium` or configure `CESIUM_BASE_URL` manually in `vite.config.ts`
- Import Cesium widget CSS
- Verify `CESIUM_ION_TOKEN` secret is set in backend

### Step 2: Fix the existing build/runtime error
- The React #31 error comes from the Asset+ viewer UMD bundle -- this is pre-existing and unrelated to our changes. No action needed unless it blocks navigation.

### Step 3: Plan for 3D model placement (future)
- For Cesium: Use `ModelGraphics` or `Cesium3DTileset` entities with georeferenced positions from `building_settings` (origin_lat, origin_lng, rotation)
- For Mapbox: Limited to 2D pins/markers. 3D model overlay is possible but complex (custom layers with THREE.js). Not recommended.
- Both use the same WGS84 coordinates -- no format conversion needed between the two maps.

### Technical Details

**Cesium asset serving problem**: `@cesium/engine` expects its `Assets/`, `Workers/`, and `ThirdParty/` directories to be available at a base URL. Without configuring this, the globe renders a black screen or crashes. The fix is either:
1. Install `vite-plugin-cesium` and add it to vite plugins
2. Or copy Cesium static assets to `public/cesium/` and set `window.CESIUM_BASE_URL = '/cesium/'`

**Coordinate system summary**:
```text
building_settings table:
  latitude, longitude    → WGS84 (used by both Mapbox and Cesium for pins)
  origin_lat, origin_lng → WGS84 origin for BIM coordinate transforms
  rotation               → Building rotation in degrees

For 3D model placement on Cesium:
  XKT (viewer format) → glTF/glb (Cesium format) → placed at origin_lat/origin_lng with rotation

For Mapbox:
  Only 2D pins using latitude/longitude — no 3D models
```

