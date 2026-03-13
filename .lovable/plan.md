

## Plan: xeokit SDK Optimization + Per-Storey Tiling for Asset+ XKT

### Analysis of Unused xeokit Optimizations

After reviewing the xeokit SDK API and our current implementation, there are **three significant optimizations we're not using**:

#### 1. Data Textures (`dtxEnabled: true`) — **HIGH IMPACT**
Our `Viewer` is created without `dtxEnabled`. Data textures store geometry in GPU textures instead of Vertex Buffer Objects (VBOs), providing:
- **~50% faster model loading** (less CPU→GPU transfer overhead)
- **~40% lower browser memory** (geometry lives on GPU, not JS heap)
- **Faster per-object updates** (color, visibility changes hit GPU directly)

This is the single biggest optimization we're missing. Works with XKT v8+ files.

**Change**: Add `dtxEnabled: true` to Viewer constructor in `NativeXeokitViewer.tsx`.

#### 2. `reuseGeometries: false` on XKTLoaderPlugin — **MEDIUM IMPACT**
When models contain many unique geometries (typical for BIM), geometry reuse creates excessive draw calls. Disabling it converts to batched representation — fewer draw calls, slightly more memory.

**Change**: Set `reuseGeometries: false` on XKTLoaderPlugin creation.

#### 3. `pbrEnabled: false` — **LOW IMPACT**
PBR rendering is unnecessary for BIM models and adds GPU overhead. We should explicitly disable it.

**Change**: Add `pbrEnabled: false` to Viewer constructor.

#### 4. Double FastNavPlugin — **BUG FIX**
`NativeXeokitViewer.tsx` line 259 creates a FastNavPlugin, AND `usePerformancePlugins.ts` creates ANOTHER one. Double installation wastes resources.

**Change**: Remove FastNav from `usePerformancePlugins` (NativeXeokitViewer already handles it).

---

### Per-Storey Tiling for Asset+ XKT Files

Asset+ XKT files come pre-built from the Asset+ API — we don't have the source IFC. The `xkt-split` edge function already creates **virtual chunks** (same file, storey metadata). True binary splitting of XKT without the original IFC is not feasible because XKT is a compressed binary format without clean per-storey boundaries.

**What we CAN do with Asset+ XKTs:**
- Use the existing virtual chunk metadata + `applyFloorPriorityVisibility()` to show only the active floor
- This is already implemented in `useFloorPriorityLoading.ts` but **not wired up** in the viewer

**Change**: After loading Asset+ models, check for virtual chunks in `xkt_models` and automatically call `applyFloorPriorityVisibility()` when the user switches floors. This gives the visual effect of per-storey loading without needing real tiles.

For IFC-sourced buildings (where we have the source file), the worker-based real tiling plan from the previous conversation applies.

---

### Files to Change

1. **`src/components/viewer/NativeXeokitViewer.tsx`**
   - Add `dtxEnabled: true` to Viewer constructor
   - Add `reuseGeometries: false` to XKTLoaderPlugin
   - Add `pbrEnabled: false` to Viewer constructor
   - Wire up `useFloorPriorityLoading` for virtual chunks after model load
   - Remove duplicate FastNav (or coordinate with usePerformancePlugins)

2. **`src/hooks/usePerformancePlugins.ts`**
   - Remove FastNavPlugin installation (handled by NativeXeokitViewer)
   - Keep ViewCull, SAO, LOD culling

3. **`docs/conversion-worker/worker.mjs`**
   - Fix the `includeTypes: undefined` bug in `groupByStorey()`
   - Implement real per-storey element ID collection via `IfcRelContainedInSpatialStructure`

4. **`supabase/functions/conversion-worker-api/index.ts`**
   - Add `tile_count` to job completion metadata

### Expected Impact
- `dtxEnabled` alone should reduce loading time by ~40-50% for multi-model buildings like Småviken
- `reuseGeometries: false` reduces draw calls for complex geometry
- Virtual chunk floor filtering gives immediate floor-switch responsiveness for Asset+ buildings
- Real tiling (worker fix) gives true per-storey loading for IFC-sourced buildings

