

## Plan: Robust IFC → XKT Pipeline with Metadata Separation

### Problem
The `ifc-to-xkt` edge function consistently hits the 150MB WORKER_LIMIT for real-world IFC files (100-500MB). The browser-side fallback exists but has reliability issues with WASM loading. Additionally, the current pipeline bundles geometry + metadata in a single pass, which is fragile and memory-intensive.

### What's Already Implemented (aligns with the tips)
Much of the suggested architecture is **already in place**:
- **Systems extraction** (IfcSystem, IfcDistributionSystem) → `systems` table
- **Spatial hierarchy** (IfcBuildingStorey, IfcSpace) → `assets` table
- **Asset connections** (topology/flow) → `asset_connections` table
- **External ID mapping** (IFC GUID → fm_guid) → `asset_external_ids` table
- **IoT sensor mapping** (Senslinc integration) → via `building_external_links` + `senslinc-query`
- **System filtering in viewer** → `ViewerFilterPanel` with discipline toggles
- **Room colorization** (temperature, CO2) → `RoomVisualizationPanel`

### What's Missing / Broken
1. **Edge function can't handle files >~30MB** due to memory limits
2. **Browser fallback WASM loading** may fail silently
3. **No separate metadata JSON** — xeokit supports `metaModelSrc` for loading metadata alongside XKT, but we embed it in the XKT binary
4. **No metadata-only export** from browser conversion (systems, connections not extracted client-side)

### Proposed Changes

#### 1. Make Browser-Side Conversion the Primary Path for IFC
Instead of trying the edge function first and falling back, **skip the edge function entirely for IFC uploads** and go straight to browser-side conversion. The edge function remains for small files or API-triggered jobs.

**File: `src/components/settings/CreateBuildingPanel.tsx`**
- Add file size check: if IFC > 20MB, skip edge function and go directly to browser conversion
- Keep edge function attempt for files ≤ 20MB

#### 2. Extract & Upload Metadata JSON Separately
After browser-side XKT conversion, extract metadata into a separate JSON file matching xeokit's `metaModelSrc` format and upload alongside the XKT.

**File: `src/services/acc-xkt-converter.ts`**
- New function `extractMetaModelJson(xktModel)` that builds the xeokit MetaModel JSON structure:
  ```json
  {
    "metaObjects": [
      { "id": "2Fh8K3", "type": "IfcAirHandlingUnit", "name": "AHU-01", "parent": "..." }
    ]
  }
  ```
- Return metadata JSON alongside XKT data from `convertToXktWithMetadata`
- Also extract systems/connections client-side (reuse the same logic from the edge function)

**File: `src/components/settings/CreateBuildingPanel.tsx`**  
- Upload `metadata.json` to storage alongside the `.xkt` file
- Persist systems and connections to DB from extracted metadata

#### 3. Load Metadata JSON in Viewer
**File: `src/components/viewer/NativeXeokitViewer.tsx`**
- When loading XKT models, check if a corresponding `metadata.json` exists in storage
- Pass it as `metaModelSrc` to `xktLoader.load()` for richer BIM queries in the viewer

#### 4. Fix WASM Loading Reliability
**File: `vite.config.ts`** + **`src/services/acc-xkt-converter.ts`**
- Add explicit WASM file existence check before parsing
- Provide clear error message if WASM files are not found at `/web-ifc-wasm/`
- Add a fetch-based WASM availability test before attempting `import('web-ifc')`

### Architecture After Changes

```text
User uploads IFC
       ↓
  File size check
       ↓
  ≤20MB → Edge Function (server)
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
    src: model.xkt,
    metaModelSrc: metadata.json
  })
```

### Files to Change
1. `src/components/settings/CreateBuildingPanel.tsx` — Size-based routing, metadata upload, system persistence
2. `src/services/acc-xkt-converter.ts` — Extract metadata JSON + systems, WASM validation
3. `src/components/viewer/NativeXeokitViewer.tsx` — Load `metaModelSrc` when available
4. `vite.config.ts` — No changes needed (WASM copy already configured)

### What This Doesn't Change
- Edge function stays as-is for small files and API-triggered conversions
- All existing DB tables (systems, asset_connections, assets) remain unchanged
- Viewer filter/coloring logic unchanged
- IoT/Senslinc integration unchanged

