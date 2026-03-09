
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

### Architecture

```text
User uploads IFC
       ↓
  File size check
       ↓
  ≤20MB → Edge Function (server) → fallback to browser on WORKER_LIMIT
  >20MB → Browser conversion (direct)
       ↓
  ┌─────────────────────────┐
  │ web-ifc + xeokit-convert│
  │                         │
  │ 1. Geometry  → .xkt     │
  │ 2. Metadata  → .json    │
  │ 3. Systems   → DB       │
  │ 4. Hierarchy → DB       │
  └─────────────────────────┘
       ↓
  Supabase Storage + DB
       ↓
  xktLoader.load({
    src/xkt: model.xkt,
    metaModelSrc: metadata.json
  })
```
