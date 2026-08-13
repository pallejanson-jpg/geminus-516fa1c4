# 3D Viewer Loading Performance — Architecture Reference

This document describes how the **native xeokit 3D viewer** (`NativeXeokitViewer` +
its supporting hooks) is tuned for fast, progressive loading of large BIM/XKT
models. It's written to be used as a baseline when comparing loading behaviour
against the other viewer surfaces in the Geminus stack (the vendor Geminus Plus
Vue viewer, and the FM Access/Tessel iframe embed — see the comparison table at
the end).

## 1. Where this lives

```
src/hooks/useXeokitInstance.ts        — SDK load, Viewer instance, camera, nav, plugins
src/hooks/useModelLoader.ts           — model discovery, 4-tier cache pipeline, progressive loading
src/hooks/useXktPreload.ts            — background preload while browsing (before viewer opens)
src/hooks/useFloorPriorityLoading.ts  — per-storey tiling / floor-priority visibility
src/services/xkt-idb-cache.ts         — IndexedDB disk cache (persists across reloads)
src/services/xkt-cache-service.ts     — Supabase-backed "cache-on-load" for XKT binaries
src/components/viewer/NativeXeokitViewer.tsx — orchestrates the above into one component
```

The vendored engine is `public/lib/xeokit/xeokit-sdk.es.js` (xeokit-sdk **v2.6.112**,
currently a straight upstream version bump from 2.6.107 — no local performance
patches to the renderer itself). All the performance work described below is in
**our application code**, not in a modified engine.

## 2. SDK & Viewer bootstrap (`useXeokitInstance`)

| Mechanism | Detail | Why |
|---|---|---|
| **SDK caching** | First load: `fetch` → `Blob` → `URL.createObjectURL` → dynamic `import()`, then cached on `window.__xeokitSdk`. Every subsequent viewer instance in the session reuses the already-parsed module. | Avoids re-fetching/re-parsing a large ES module bundle every time a building/viewer is opened. |
| **Renderer flags** | `saoEnabled: false`, `pbrEnabled: false`, `dtxEnabled: true`, `entityOffsetsEnabled: true`, `transparent: true` | SAO and PBR are the most expensive per-pixel shader features — both are off by default. `dtxEnabled` (data-texture scene representation) is xeokit's memory-efficient GPU storage path for large models, replacing per-object VBOs. |
| **Edge rendering tuning** | `edgeMaterial.edgeAlpha = 0.25`, `edgeWidth = 1` | Avoids moiré/rastering artifacts on dense geometry without disabling edges outright. |
| **XKTLoaderPlugin** | `reuseGeometries: true` | Deduplicates identical geometry buffers across instanced objects (e.g. repeated windows, doors, structural members) — large GPU memory savings on typical BIM models. |
| **FastNavPlugin** (opt-in via `localStorage['viewer-fastnav-enabled']`) | While navigating: `scaleCanvasResolutionFactor: 0.6`, `hideEdges: true`, `hideSAO: true`; restores full quality `0.3–0.5s` after interaction stops. | Classic "cheap while moving, sharp at rest" LOD trick — cuts fill-rate cost during camera movement on lower-end GPUs. |
| **ViewCullPlugin** | `maxTreeDepth: 20` (kd-tree frustum culling) | Reduces draw calls for large/spread-out models by not submitting off-screen geometry to the GPU. |
| **Camera control tuning** | Desktop vs. mobile navigation rates (rotation/pan/dolly inertia, speed multiplier from `localStorage['viewer-nav-speed']`); mobile gets `smartPivot`, tuned dolly thresholds, first-person disabled. | Not a load-time optimization, but part of "feels fast" — smooth interaction is tuned per device class. |
| **WebGL context-loss handling** | Listener on `webglcontextlost` destroys non-architectural ("secondary") models first, and surfaces a recovery UI instead of a blank canvas. | Large multi-model buildings can exhaust GPU memory; graceful degradation beats a silent crash. |

## 3. Four-tier model data pipeline (`useModelLoader`, `xkt-idb-cache`, `xkt-cache-service`, `useXktPreload`)

Every XKT binary is fetched through a strict fastest-first waterfall:

```
1. In-memory (JS Map)     — fastest, per-session only
2. IndexedDB (disk)       — survives reload/restart, no network
3. Supabase Storage       — network, signed URL (1h TTL)
4. Direct Asset+ API      — last resort, streams straight from Geminus Plus
```

| Tier | Store | Limits / eviction | Notes |
|---|---|---|---|
| **1. Memory** | `Map<string, ArrayBuffer>` (`useXktPreload.ts`) | Global cap **200 MB**; **skips caching** any single model **> 30 MB**; LRU-ish eviction (oldest entries dropped first) when the cap would be exceeded | Avoids cache thrashing from a handful of huge MEP models pushing out everything else. |
| **2. IndexedDB** | `geminus-xkt-cache` DB, two object stores (`models`, `meta`) (`xkt-idb-cache.ts`) | Relies on browser storage quota; explicit eviction only if `navigator.storage.estimate()` reports free space `< 100 MB`, oldest-first per building | Staleness check compares `xkt_models.updated_at` against the stored `modelUpdatedAt` — stale entries are treated as a cache miss and re-fetched, not silently served. |
| **3. Supabase Storage** | Signed URL, `xkt-models` bucket | Files `> 30 MB` are handed to `XKTLoaderPlugin` as a **streamed `src`** (network-progressive parse) instead of buffered via `fetch()` + `ArrayBuffer` | Streaming avoids holding the whole payload in JS memory before the loader can start parsing. |
| **4. Direct Asset+ stream** | `GetXktData` API, tried with `context=Default` then `Building` | 120s timeout, minimum 50 KB sanity check on response | Only reached when a model has no `storage_path` (too large for storage, or never synced) — last-resort but still gets cached to IDB immediately so it's tier-2 next time. |

**Cache-on-load**: on tier-3/4 success the binary is opportunistically written back to
both IndexedDB (`xktIdbCache.put`, fire-and-forget) and Supabase Storage
(`xktCacheService.saveModelFromViewer`), so the *next* user to open that building
gets a tier-2/3 hit instead of repeating the same waterfall.

**Background preload** (`useXktPreload`): while a user is still browsing the
portfolio/list view — before they've opened the 3D viewer — the A-model (see
below) for the building under the cursor is silently pulled from IDB or storage
into memory. If it's already there by the time the viewer mounts, load time for
that model is ~0.

## 4. Progressive, priority-ordered loading (`loadAllModels`)

A building typically has one architectural ("A-") model plus many secondary
engineering models (MEP, sprinkler, electrical, ventilation…). Loading strategy:

- **Priority split**: models are classified `isArchitectural()` by name prefix
  (`A…`/`ARKITEKT…`, excluding `BRAND/FIRE/V-/EL-/MEP/K-/R-/S-…`). Architectural
  models load first and are shown as soon as they're in; everything else is
  deferred to a **secondary queue** that's lazy-loaded on demand (toolbar
  trigger), never auto-loaded up front.
- **Concurrency cap**: `CONCURRENT = isMobile ? 1 : 2` simultaneous model loads —
  bounded to avoid saturating a mobile device's memory/GPU or the network on
  desktop.
- **Progressive visibility**: each model fires `viewer.scene` updates and an
  `onProgress` callback as soon as *it* finishes — the user sees geometry
  appear building-block by building-block rather than waiting for the full set.
- **Empty-scene fallback**: if the A-model set produces 0 entities (bad/missing
  data), the secondary queue is force-loaded so the viewer never silently shows
  nothing.
- **Soft memory guard**: estimated combined size vs. a soft limit
  (**150 MB desktop / 60 MB mobile**) — if exceeded, secondary models stay
  deferred rather than being auto-promoted, with a console warning.
- **Mobile guard**: secondary (non-A) models are *never* auto-loaded on mobile —
  purely opt-in via the toolbar.
- **Storey/floor tiling** (`useFloorPriorityLoading`): when `xkt_models` rows are
  flagged `is_chunk` with a `storey_fm_guid`, two modes are supported:
  - *Virtual chunks* (Phase 1): one monolithic XKT, chunk metadata used only for
    visibility filtering (x-ray non-active floors) — no extra network cost.
  - *Real tiles* (Phase 2, detected when chunks have distinct `storage_path`s):
    only the active floor + its two neighbours are loaded initially; switching
    floors dispatches `FLOOR_TILE_SWITCH` to stream in the next tile set. This
    is the mechanism that keeps very tall buildings loadable without pulling
    every floor's geometry up front.
- **Metadata sidecar**: `_metadata.json` files (IFC property sets) are only
  attached (`metaModelSrc`) when present in storage — avoids a guaranteed-404
  round trip per model.

## 5. Post-load optimizations

- Camera `flyTo` on initial fit uses `duration: 0` — instant framing, no
  animation cost on first paint (skipped in split 2D/3D mode where framing
  isn't needed yet).
- Native XKT colours are captured once into a `Map` immediately after load
  (`__xeokitNativeColors`) so the architect colour palette / "native colours"
  toggle can be swapped without re-reading the scene graph each time.
- Bulk state resets (`setObjectsXRayed`, `setObjectsSelected`,
  `setObjectsColorized`) are done in single batched calls over the full ID
  array rather than per-entity loops.
- `viewer.scene.sao.enabled = false` is re-asserted post-load in case a plugin
  re-enabled it.

## 6. Key tunables at a glance

| Parameter | Value | Location |
|---|---|---|
| Memory cache cap | 200 MB total, 30 MB single-model skip threshold | `useXktPreload.ts` |
| IDB low-quota eviction trigger | < 100 MB free | `xkt-idb-cache.ts` |
| Streaming threshold (storage → loader) | > 30 MB | `useModelLoader.ts` (`loadSingleModel`) |
| Concurrent model loads | 2 desktop / 1 mobile | `useModelLoader.ts` (`loadAllModels`) |
| Soft memory guard (combined primary+secondary) | 150 MB desktop / 60 MB mobile | `useModelLoader.ts` |
| Cache staleness window (legacy edge-function path) | 7 days | `xkt-cache-service.ts` |
| FastNav resolution scale while navigating | 0.6× | `useXeokitInstance.ts` |
| FastNav restore delay | 0.3s desktop / 0.5s mobile | `useXeokitInstance.ts` |
| Direct-stream API timeout | 120s | `useModelLoader.ts` (`loadFromAssetPlus`) |
| Per-model load timeout (waitForModel) | 90s (secondary), 120s (direct-stream) | `useModelLoader.ts` |

## 7. Comparison with the other Geminus viewer surfaces

| | **Native xeokit viewer** (this doc) | **Geminus Plus / Asset+ Vue viewer** | **FM Access (Tessel/HDC) embed** |
|---|---|---|---|
| Where used | `NativeXeokitViewer.tsx` — Navigator, Portfolio, Building Insights | Vendor-supplied `assetplusviewer.umd.min.js` bundle (see [`3D_viewer_package.md`](3D_viewer_package.md)) | `GeminusBaseV2ViewerPanel.tsx` — iframe to Tessel/HDC's own hosted client |
| Loading control | Full — we own the XKT fetch/cache/priority pipeline | Partial — we choose which models load via `additionalDefaultPredicate`, but the fetch/cache internals are the vendor's | None — it's a fully external app in an iframe; we only do postMessage-based auth + navigation commands |
| Client-side caching | 4-tier (memory → IDB → Storage → API), cache-on-load write-back | Unknown/opaque — vendor-managed, no visibility from our code | None on our side — whatever Tessel/HDC does server- or browser-side is invisible to us |
| Progressive/priority loading | Yes — A-model first, concurrent queue, floor tiling | Model filtering only (`additionalDefaultPredicate`), no tiling/priority queue exposed | No — the embedded app loads its own drawing/viewport, we don't control sequencing |
| Device-aware tuning | Yes — concurrency, memory caps, FastNav, nav rates all branch on mobile | No device-specific hooks exposed | Whatever the vendor app itself does (opaque) |
| Failure/degradation handling | WebGL context-loss recovery, empty-scene fallback, per-tier fallback chain | Relies on vendor's own error handling | 15s reveal-fallback timer + retry button; no deeper recovery available to us |

**Takeaway for comparison**: the native xeokit viewer is the only one of the
three where loading performance is something *we* can measure, tune, and
regress-test — the other two are effectively black boxes whose load behaviour
we can only observe from the outside (network tab, wall-clock time to first
paint).
