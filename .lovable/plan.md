

# Analysis: 3D Performance Bottlenecks & Alternative Approaches

## 1. AssetPlusViewer vs Native xeokit Viewer — Honest Assessment

**Current architecture**: `AssetPlusViewer.tsx` (5,119 lines) wraps a Vue-based Asset+ component (`assetplusviewer.umd.min.js`) which internally creates a xeokit `Viewer`. Access to xeokit is indirect: `viewer.$refs.AssetViewer.$refs.assetView.viewer`.

**What Asset+ gives you**:
- Model loading via `setAvailableModelsByFmGuid` — fetches models from Asset+ API by building GUID
- Floor cutout (`cutOutFloorsByFmGuid`), space visibility, display actions
- DevExtreme-based property panels (which you're already suppressing/replacing)
- Annotation system (which you've largely replaced with custom DOM markers)

**What Asset+ costs you**:
- You cannot control the XKT loading pipeline directly. The viewer calls its own API to discover models, then fetches them. Your fetch interceptor is a hack around this — it monkey-patches `window.fetch` to intercept `.xkt` URLs and serve from cache.
- Vue→React bridge overhead. Every callback goes through Vue refs.
- The 5,119-line wrapper is mostly reimplementing what xeokit provides natively: camera control, picking, annotations, x-ray, context menus, NavCube.
- You have no control over model loading order, parallelism, or progressive display.

**Recommendation**: A migration to native xeokit `Viewer` + `XKTLoaderPlugin` would:
- Give you direct control over model loading (order, parallelism, progress callbacks)
- Eliminate the fetch interceptor hack — load XKT from Supabase Storage directly
- Remove the Vue dependency (~300KB UMD bundle)
- Reduce `AssetPlusViewer.tsx` from 5,119 lines to ~1,500

**Risk**: You lose `setAvailableModelsByFmGuid` and `cutOutFloorsByFmGuid`. But you've already implemented floor isolation (`useFloorPriorityLoading`), model visibility (`useModelData`), and most display actions manually.

**Effort**: 2-3 weeks. Can be done incrementally by creating a `NativeXeokitViewer.tsx` alongside the existing one and switching via a feature flag.

---

## 2. XKT Cache — Why You See No Difference

The cache IS working, but the bottleneck is elsewhere. Here's the actual flow:

```text
1. Asset+ viewer calls its API → discovers model list
2. Asset+ viewer calls fetch() for each .xkt URL
3. Your interceptor catches the fetch:
   a. Checks memory cache → hit? serve instantly
   b. Checks DB cache → hit? fetch from Supabase Storage
   c. Miss? let Asset+ fetch from its API, then cache in background
```

**Problem 1**: Step 1 (API discovery) happens every time the viewer mounts. This is a network roundtrip to Asset+ API that you cannot skip with the current wrapper.

**Problem 2**: On first load, step 3c applies — models are fetched from Asset+ API AND cached. The caching happens in background but doesn't speed up the current load.

**Problem 3**: On subsequent loads, step 3b applies — but you're fetching from Supabase Storage instead of Asset+ API. The speed difference between these two CDNs may be negligible.

**Problem 4**: Memory preload (`useXktPreload`) runs when the building is selected, but if the user opens the viewer quickly, the preload may not have finished. And models >30MB are skipped entirely.

**What would actually help**: Loading XKT files directly from Supabase Storage with `XKTLoaderPlugin.load({ src: signedUrl })` — skipping the Asset+ API entirely. This requires the native xeokit migration.

---

## 3. Fragments 2.0 (That Open Company) — Research Summary

**What it is**: `@thatopen/fragments` (v3.3.6, published yesterday) is an open-source library from the creators of IFC.js. It provides:

- `.frag` format — a highly compressed binary format for BIM geometry (~10x smaller than IFC)
- Server-side IFC→Fragments conversion (runs in Node.js, not browser WASM)
- Streaming/progressive loading with LOD
- Built on Three.js (not xeokit)
- Open source, MIT licensed

**Key advantages over your current pipeline**:
- Server-side conversion eliminates the 276MB-IFC-in-browser-WASM problem
- `.frag` files are dramatically smaller than XKT
- Built-in property/spatial indexing for fast queries
- Active development (82 versions, updated daily)

**Key disadvantages**:
- Three.js renderer, not xeokit — would require replacing the entire viewer stack
- No direct ACC integration — you'd still need your own pipeline to get IFC files from ACC
- Less mature than xeokit for enterprise BIM (smaller community)
- Would lose all existing xeokit-specific features (SAO, FastNav, ViewCull, etc.)

**ACC→Geminus pipeline alternatives**:

| Approach | IFC Source | Conversion | Viewer | Effort |
|----------|-----------|------------|--------|--------|
| Current | ACC API → SVF2 (fails) or IFC upload | Client WASM (slow) | Asset+ (xeokit) | Done |
| Option A | ACC API → IFC download | Server-side XKT (edge function) | Native xeokit | 2-3w |
| Option B | ACC API → IFC download | Server-side Fragments | ThatOpen viewer | 6-8w |
| Option C | ACC API → IFC download | Server-side XKT (edge function) | Native xeokit + preload | 3-4w |

**My recommendation**: Option A/C — migrate to native xeokit viewer AND move IFC→XKT conversion server-side. This gives you:
1. Direct model loading from Supabase Storage (no fetch interceptor)
2. Server-side conversion for large IFC files (no browser WASM)
3. Keeps all existing xeokit features
4. Smallest migration effort

Fragments 2.0 is interesting for a future evaluation but replacing the entire rendering stack is too risky right now.

---

## Proposed Next Steps

1. **Add XKT cache diagnostics** — Console logging showing cache hit/miss/timing for every model load so you can verify the cache is actually helping
2. **Create server-side IFC→XKT edge function** — Move the heavy WASM parsing to a backend function, eliminating the browser bottleneck for large files
3. **Prototype native xeokit viewer** — Create `NativeXeokitViewer.tsx` behind a feature flag, loading XKT directly from Supabase Storage with `XKTLoaderPlugin`
4. **Evaluate Fragments** — Set up a standalone test page with `@thatopen/fragments` to benchmark load times against xeokit with the same IFC files

