## Plan: IFC & ACC Import/Sync Performance Optimization (IMPLEMENTED ✅)

### Changes Made
1. **XKT compression** (`ifc-to-xkt`): Enabled `zip: true` in `writeXKTModelToArrayBuffer` — ~30% smaller XKT files
2. **Parallel DB writes** (`ifc-to-xkt`): `persistSystemsAndConnections` + `populateAssetsFromMetaObjects` now run via `Promise.all` instead of sequentially
3. **Streaming LD-JSON parser** (`acc-sync`): New `streamLDJSON()` async generator processes BIM property files line-by-line from `ReadableStream` — eliminates OOM risk on large Revit models
4. **Incremental ACC sync** (`acc-sync`): `fetchAccAssets` now supports `filter[updatedAt]` parameter, only fetching assets modified since last sync — ~90% faster re-syncs
5. **IFC derivative from ACC** (`acc-sync`): `translate-model` now requests IFC format alongside SVF. On completion, downloads the IFC derivative and feeds it into `ifc-to-xkt` for real per-storey tiling — unifying ACC and IFC geometry pipelines
6. **Dual pipeline** (`check-translation`): Triggers both `ifc-to-xkt` (for tiled XKT) and `acc-geometry-extract` (for GLB fallback) in parallel when translation succeeds

---

## Plan: Mobile Viewer Startup Hardening (IMPLEMENTED ✅)

### Changes Made
1. **Mobile touch tuning** (`NativeXeokitViewer.tsx`): dragRotationRate 30→70, touchPanRate 0.06→0.14, touchDollyRate 0.04→0.09, rotationInertia 0.93→0.88, panInertia 0.88→0.82
2. **FastNav delay** (`NativeXeokitViewer.tsx`): Added `delayBeforeRestore: true` (0.5s mobile, 0.3s desktop)
3. **Suppress viewFit in split2d3d** (`NativeXeokitViewer.tsx`): Skips instant viewFit when `?mode=split2d3d` — floor isolation handles camera
4. **Defer SplitPlanView mount** (`UnifiedViewer.tsx`): Mobile SplitPlanView only renders after `viewerReady=true`, shows spinner until then
5. **Increased SplitPlanView retry** (`SplitPlanView.tsx`): 10×100ms → 30×200ms (6s total window), immediate retry on VIEWER_MODELS_LOADED
6. **Debounced floor events** (`UnifiedViewer.tsx`): 500ms guard on FLOOR_SELECTION_CHANGED dispatches to prevent competing events

### Architecture Principle
Mobile and desktop share the same `UnifiedViewerContent` initialization logic. The ONLY difference is layout:
- Mobile: vertical stack (2D top, 3D bottom) with touch-optimized divider (8px)
- Desktop: horizontal ResizablePanelGroup with drag handle (4px)

Future changes to viewer startup MUST apply to both paths. Do NOT create separate mobile/desktop init logic.

---

## Plan: SplitPlanView Navigation + Alignment UX (IMPLEMENTED ✅)

### Changes Made
1. **SplitPlanView click navigation** (`SplitPlanView.tsx`): Replaced first-person instant jump with MinimapPanel-style fly-to — keeps current eye height, looks down at clicked point, animates 0.5s.
2. **AlignmentPointPicker precision** (`AlignmentPointPicker.tsx`): Now estimates surface point via ray-cast from tripod position + viewing direction × adjustable distance slider (0.5–10m). Shows captured coordinates and distance in both steps for verification.

---

## Plan: ACC Geometry Pipeline — GLB Per-Storey Chunks (IMPLEMENTED Phase 1)

### Changes Made
1. **Plan document** saved to `docs/plans/acc-obj-pipeline-plan.md`
2. **Edge function `acc-geometry-extract`** — extracts SVF properties, builds Level grouping, creates manifest + geometry_index, stores in `xkt-models` bucket
3. **Shared types** added to `src/lib/types.ts` (GeometryManifest, GeometryManifestChunk, GeometryIndexEntry)
4. **NativeXeokitViewer** enhanced with GLTFLoaderPlugin + manifest-driven GLB chunk loading
5. **config.toml** updated with `acc-geometry-extract` function entry

### Pending (Phase 2)
- Actual GLB chunk creation from SVF geometry (requires conversion worker)
- OBJ as optional secondary format for small models

---


### Ändringar

#### 1. `conversion-worker-api` — ny `/populate-hierarchy` endpoint
**Fil:** `supabase/functions/conversion-worker-api/index.ts`
- Ny `POST /populate-hierarchy` action som accepterar `storeys`, `spaces`, `instances`
- Deterministisk GUID-generering via SHA-256 hash → UUID v5-format
- Upsert till `assets` med `created_in_model: true`
- Diff-logik: markerar borttagna objekt med `modification_status = 'removed'`

#### 2. `ifc-to-xkt` — `populateAssetsFromMetaObjects()`
**Fil:** `supabase/functions/ifc-to-xkt/index.ts`
- Ny funktion `populateAssetsFromMetaObjects()` körs efter steg 8 (persist systems)
- Tre pass: storeys → spaces → instances (non-spatial, non-relationship)
- Använder IFC GlobalId som `fm_guid`, fallback till deterministisk hash
- Löser storey-tillhörighet genom att vandra uppåt i parent-kedjan
- Diff: soft-delete objekt som finns i DB men inte i ny IFC

#### 3. `worker.mjs` — anropar `/populate-hierarchy` efter konvertering
**Fil:** `docs/conversion-worker/worker.mjs`
- Ny `extractHierarchy()` funktion som parserar IFC med web-ifc
- Efter `/complete`, extraherar storeys/spaces och anropar `/populate-hierarchy`
- Non-fatal: om hierarki-population misslyckas fortsätter workern

#### 4. `CreateBuildingPanel` — deterministiska GUIDs + diff
**Fil:** `src/components/settings/CreateBuildingPanel.tsx`
- Ändrat från `crypto.randomUUID()` till IFC GlobalId eller deterministisk hash
- `created_in_model: true` istället för `false`
- Diff-logik: markerar borttagna objekt efter import

### Datamodell

```text
Building Storey:
  fm_guid:           IFC GlobalId || sha256(buildingGuid + name + "IfcBuildingStorey")
  category:          "Building Storey"
  created_in_model:  true

Space:
  fm_guid:           IFC GlobalId || sha256(buildingGuid + name + "IfcSpace")
  category:          "Space"
  level_fm_guid:     parent storey fm_guid

Instance:
  fm_guid:           IFC GlobalId || sha256(buildingGuid + name + ifcType)
  category:          "Instance"
  asset_type:        ifcType (e.g. "IfcDoor")
  level_fm_guid:     resolved storey
  in_room_fm_guid:   resolved space
```

### Diff-flöde

Vid omimport jämförs importerade fm_guids mot befintliga i DB:
- **Nytt** → INSERT
- **Matchat** → UPDATE (namn, typ, rumsplacering)
- **Borttaget** → `modification_status = 'removed'` (soft-delete)

---

## Plan: CRUD-flöde & FM Access-data i Properties (IMPLEMENTED ✅)

### Changes Made
1. **FM Access Delete**: `handleDelete()` in `UniversalPropertiesDialog.tsx` now calls `deleteFmAccessObject(guid)` best-effort after successful `deleteAssets()` — completing the CRUD cycle to FM Access
2. **DOU Section**: New collapsible "Drift & Underhåll" section in Properties dialog, fetching from `fm_access_dou` table by object `fm_guid`
3. **Documents Section**: New collapsible "Dokument (FM Access)" section showing documents from `fm_access_documents` by `building_fm_guid`

### Pending (Parkerat)
- FM Access symbol placement via graphics API (requires dedicated edge function + API investigation)
- FMA 2D Viewer as visualization engine (recommendation: continue using xeokit for heatmaps)

---

## Previous Plans

### Robust IFC → XKT Pipeline with Metadata Separation (IMPLEMENTED)
- Browser-primary for >20MB, edge function for ≤20MB
- MetaModel JSON uploaded alongside XKT
- Systems extracted and persisted

### External Conversion Worker + Per-Storey XKT Tiling (IMPLEMENTED)
- Standalone Node.js worker polls conversion-worker-api
- Per-storey .xkt tiles with dynamic floor loading

### Per-Building API Credentials for Asset+ and Senslinc (IMPLEMENTED)
- 10 credential override columns on building_settings
- Shared credential resolver in edge functions
- Properties page as configuration hub
