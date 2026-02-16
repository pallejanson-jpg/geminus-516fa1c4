

## Plan: XKT Loading Performance, Cache Validation, ACC 3D Pipeline & Split Screen Camera Sync

This plan addresses five interconnected areas related to 3D model loading and viewer coordination.

---

### 1. Preserve 3D Viewer State When Navigating Within the Same Building

**Problem:**
When navigating from the viewer back to the portfolio/Insights and then re-entering the 3D viewer for the *same* building, the `AssetPlusViewer` component is fully unmounted and re-initialized. This happens because:
- The viewer lives at route `/split-viewer` while the portfolio/insights pages live under `/*` (AppLayout)
- React Router unmounts the entire `/split-viewer` component tree when navigating away
- On return, `initializeViewer()` runs again: fetches a token, mounts the AssetPlus UMD bundle, and waits for all XKT models to download again

The mode switcher (3D/Split/VT/360) within UnifiedViewer already works correctly because it keeps a single `AssetPlusViewer` instance mounted and only toggles CSS visibility.

**Solution:**
The xktMemoryCache (global `Map<string, ArrayBuffer>`) already persists across component unmounts because it is module-scoped. The real bottleneck is that `initializeViewer` re-fetches the access token, re-mounts the Vue component, and re-requests all models from Asset+ (which in turn triggers fresh XKT downloads). The fetch interceptor already serves models from memory cache when available, but the overall initialization ceremony still takes 5-10 seconds.

**Changes:**

a) **Skip Asset+ API re-fetch when models are in memory** (`AssetPlusViewer.tsx`):
   - Before calling `assetplusviewer(...)`, check if all models for this building are already in the `xktMemoryCache`
   - If yes, set `cacheStatus` to `'hit'` and log it - the fetch interceptor will serve them from memory, so the XKT download phase becomes near-instant
   - Add a timing log around `initializeViewer` so we can measure the improvement

b) **Cache the Asset+ access token in sessionStorage** (`AssetPlusViewer.tsx`):
   - Store `{ token, expiresAt }` in `sessionStorage` after fetching from the edge function
   - On next init, check if a valid (not expired) token exists and skip the edge function call
   - This saves ~500-1000ms per re-initialization

c) **Cache the API config** (`AssetPlusViewer.tsx`):
   - Store `{ apiUrl, apiKey }` in `sessionStorage` after the `getConfig` call
   - Skip the second edge function call on re-init if cached

These changes together reduce the "returning to same building" scenario from ~8-15 seconds to ~2-3 seconds (DOM mount + Vue bootstrap + instant XKT from memory).

---

### 2. Validate Cached XKT Models Against Asset+ Source Data

**Problem:**
The `xkt_models` table stores cached models with `synced_at` but never checks if the source model in Asset+ has been updated since. For Akerselva Atrium, the cached XKT is stale because Asset+ has a newer version.

**Current state in database (6 entries across 3 buildings):**
- Building `755950d9...` (likely current test building): 3 models, synced 2026-02-16
- Building `a8fe5835...` (Akerselva Atrium?): 2 models, synced 2026-02-13
- Building `9baa7a3a...`: 1 model, synced 2026-02-09

The `source_url` column is NULL for all entries, and there is no `source_updated_at` timestamp to compare against.

**Solution:**

a) **Add source timestamp tracking** (database migration):
   - Add column `source_updated_at` (timestamptz, nullable) to `xkt_models` table
   - This will store the `sourceUpdatedAt` from the Asset+ API response

b) **Capture source timestamp during Cache-on-Load** (`AssetPlusViewer.tsx`):
   - When the fetch interceptor captures an XKT model from Asset+, extract the source URL and any `Last-Modified` or model metadata
   - Pass it to `saveModelFromViewer` and store it in `source_updated_at`

c) **Staleness check before serving from cache** (`xkt-cache-service.ts`):
   - In `checkCache()`, when a database hit is found, compare `synced_at` with a configurable max age (e.g. 7 days)
   - If the cached model is older than the threshold, mark it as `stale` in the return value
   - The fetch interceptor will then fetch from Asset+ instead of cache, and the Cache-on-Load mechanism will update the cached version

d) **Add manual cache invalidation** (optional, in settings):
   - Add a "Rensa 3D-cache" button in the building settings or viewer toolbar
   - This deletes the `xkt_models` entries for the building and forces a fresh load

---

### 3. ACC 3D Pipeline Assessment

**Current pipeline:**
1. RVT file in Autodesk Construction Cloud
2. Translate via Model Derivative API (RVT to SVF2)
3. Download derivative (attempts glTF/OBJ, falls back to server SVF-to-GLB conversion)
4. Convert GLB to XKT client-side using `@xeokit/xeokit-convert`
5. Store XKT in `xkt-models` bucket

**Known issues:**
- RVT files produce SVF2 format, NOT glTF/GLB directly. The `detectFormat` function in `acc-xkt-converter.ts` correctly identifies this and shows an error about SVF2 manifests
- The server-side SVF-to-GLB conversion (`acc-svf-to-gltf` edge function) is the fallback, but edge functions have a 25-minute timeout and memory constraints
- IFC files are explicitly rejected from client-side conversion (`throw new Error('IFC-format stods inte...')`)

**Assessment:** The pipeline is fundamentally correct but has practical issues:
- **SVF2 is the blocker**: Autodesk's Model Derivative API produces SVF2 for RVT files, not OBJ/glTF. Client-side conversion cannot handle SVF2
- **Server conversion is fragile**: The edge function (`acc-svf-to-gltf`) has tight memory/time constraints
- **IFC would be simpler**: IFC files can be converted to XKT directly using `@xeokit/xeokit-convert` with the IFC parser, but this is currently blocked (`throw new Error`)

**Recommended changes:**

a) **Enable IFC-to-XKT conversion** (`acc-xkt-converter.ts`):
   - The `@xeokit/xeokit-convert` library supports `parseIFCIntoXKTModel` with a WASM-based parser
   - Replace the IFC rejection with actual conversion
   - This gives users a direct path: upload IFC to ACC -> sync to Geminus -> convert to XKT

b) **Add IFC format option in ACC sync UI** (`ApiSettingsModal.tsx`):
   - When selecting files, indicate which formats are supported for 3D (IFC preferred, RVT via server conversion)
   - Show a recommendation to use IFC when available

c) **Improve error messaging** for RVT/SVF2 failures to explain that IFC is preferred

---

### 4. Split Screen Camera Synchronization Status

**Current implementation:**
- `useViewerCameraSync.ts` subscribes to xeokit `camera.viewMatrix` events and broadcasts position/heading/pitch via `ViewerSyncContext`
- `useVirtualTwinSync.ts` handles the VT (overlay) mode unidirectionally
- `useIvionCameraSync.ts` handles Ivion SDK camera sync
- `ivion-bim-transform.ts` provides bidirectional coordinate mapping with rotation + translation

**What works:**
- VT mode (overlay): one-directional sync from Ivion to 3D (driven by `useVirtualTwinSync`)
- Split mode: bidirectional sync via `ViewerSyncContext` with `syncLocked` toggle

**What does NOT work well:**
- Point-picking for calibration (the AlignmentPointPicker) requires the user to click in 360 and then click on a BIM surface. The BIM surface click must return coordinates in the xeokit local space, but this fails if the scene hasn't finished loading or if the pick ray doesn't hit geometry
- The coordinate transform is a simple Y-rotation + XYZ offset, which may not be sufficient for buildings where the BIM model has a non-trivial origin or is rotated in multiple axes

**Recommended changes:**

a) **Improve point-picking reliability** (`AlignmentPointPicker.tsx`):
   - Add visual feedback when waiting for a BIM surface click (pulsing cursor, instruction toast)
   - Validate that the picked point is on an actual mesh (not empty space) before accepting it
   - Store the raw picked coordinates for debugging

b) **Add coordinate diagnostic overlay** (new utility):
   - Display current camera position in both Ivion and BIM coordinates as a small debug panel
   - Show the computed transform parameters live
   - This helps identify when the transform is wrong

c) **Multi-point calibration** (future, stretch goal):
   - Allow 2-3 calibration points to compute a better transform (least-squares fit)
   - This handles cases where simple rotation+offset is insufficient

---

### 5. Implementation Priority and Sequencing

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | Token/config caching + memory cache fast path | Small | High - saves 5-10s on re-entry |
| 2 | Cache staleness check (max-age threshold) | Small | Medium - prevents stale models |
| 3 | Manual cache invalidation button | Small | Medium - user control |
| 4 | Enable IFC-to-XKT conversion | Medium | High - unlocks ACC 3D for IFC files |
| 5 | Point-picking reliability improvements | Medium | Medium - unblocks calibration |
| 6 | Coordinate diagnostic overlay | Small | Medium - debugging aid |

---

### Technical Details

**Token caching pattern:**
```typescript
const TOKEN_CACHE_KEY = 'geminus_ap_token';
const cached = sessionStorage.getItem(TOKEN_CACHE_KEY);
if (cached) {
  const { token, expiresAt } = JSON.parse(cached);
  if (Date.now() < expiresAt - 60000) { // 1 min margin
    accessTokenRef.current = token;
    // Skip edge function call
  }
}
```

**Staleness check pattern:**
```typescript
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const isStale = (syncedAt: string) => {
  return Date.now() - new Date(syncedAt).getTime() > MAX_CACHE_AGE_MS;
};
```

**IFC conversion enablement:**
```typescript
// In acc-xkt-converter.ts, replace:
if (format === 'ifc') {
  throw new Error('IFC-format stods inte...');
}
// With:
if (format === 'ifc') {
  logger('Parsing IFC into XKTModel via WASM...');
  const mod = await import('@xeokit/xeokit-convert');
  if (typeof mod.parseIFCIntoXKTModel === 'function') {
    await mod.parseIFCIntoXKTModel({
      data: new Uint8Array(glbData),
      xktModel,
      wasmPath: '/lib/xeokit/',
      log: logger,
    });
  }
}
```

