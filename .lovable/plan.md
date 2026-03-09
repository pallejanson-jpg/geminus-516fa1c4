
## Plan: Robust IFC → XKT Pipeline with Metadata Separation (IMPLEMENTED)

### Changes Made

#### 1. Browser-Primary Conversion for Large IFC Files
**File: `src/components/settings/CreateBuildingPanel.tsx`**
- Files >20MB skip edge function entirely → direct browser conversion
- Files ≤20MB still try edge function first with WORKER_LIMIT fallback
- Extracted `runBrowserConversion()` helper for DRY reuse between direct and fallback paths
- Browser conversion now uploads `metadata.json` alongside `.xkt`
- Systems extracted client-side are persisted to `systems` + `asset_system` tables

#### 2. Metadata Extraction & Separate JSON
**File: `src/services/acc-xkt-converter.ts`**
- `convertToXktWithMetadata()` now returns `metaModelJson` (xeokit MetaModel format) + `systems[]`
- WASM validation: explicit `HEAD` request to `/web-ifc-wasm/web-ifc.wasm` before importing
- `inferDiscipline()` function for system classification (Ventilation, Heating, etc.)
- System extraction from metaObjects: IfcSystem, IfcDistributionSystem, PropertySet grouping

#### 3. Viewer MetaModel Loading
**File: `src/components/viewer/NativeXeokitViewer.tsx`**
- Before loading each XKT model, checks for `{modelId}_metadata.json` in storage
- If found, passes as `metaModelSrc` to `xktLoader.load()` for richer BIM queries
- Works for all three loading paths: memory, streaming, and buffer

---

## Plan: External Conversion Worker + Per-Storey XKT Tiling (IMPLEMENTED)

### Architecture

```text
IFC Upload → Supabase Storage → conversion_jobs (pending)
       ↓
External Worker (polls conversion-worker-api)
  - Downloads IFC via signed URL
  - Groups objects by IfcBuildingStorey
  - Generates per-storey .xkt tiles
  - Uploads tiles to storage
  - Reports completion → xkt_models records created
       ↓
Viewer detects real tiles (unique storage_paths)
  - Loads active floor tile (~15MB)
  - Lazy-loads adjacent floors on FLOOR_TILE_SWITCH event
  - Unloads distant floors to save memory
  - Falls back to monolithic loading if no real tiles
```

### Files Created/Changed

| File | Action |
|------|--------|
| `supabase/functions/conversion-worker-api/index.ts` | Created — worker API (pending/claim/progress/complete/fail/upload-url) |
| `supabase/config.toml` | Added verify_jwt = false entry |
| `docs/conversion-worker/worker.mjs` | Created — standalone Node.js worker |
| `docs/conversion-worker/Dockerfile` | Created — Docker deployment |
| `docs/conversion-worker/README.md` | Created — deployment guide |
| `src/components/viewer/NativeXeokitViewer.tsx` | Updated — real tile detection + FLOOR_TILE_SWITCH listener |
| `src/hooks/useFloorPriorityLoading.ts` | Updated — isRealTiling + getTilesToLoad + FLOOR_TILE_SWITCH dispatch |

### Key Concepts

- **Virtual chunks (Phase 1)**: Same XKT file, visibility filtering by storey metadata
- **Real tiles (Phase 2)**: Separate per-storey XKT files with unique `storage_path` values
- Detection: `isRealTiling()` checks if chunks have >1 unique storage paths
- Dynamic loading: `FLOOR_TILE_SWITCH` custom event triggers load/unload of tiles
- Worker auth: `WORKER_API_SECRET` shared secret (not JWT)
