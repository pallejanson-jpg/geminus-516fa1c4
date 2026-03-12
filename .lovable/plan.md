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

## Plan: SplitPlanView Navigation + Alignment UX (PENDING — start separately)

### Issue 1: SplitPlanView click navigation doesn't match MinimapPanel
- **Root cause**: SplitPlanView does instant jump (duration:0) to first-person at 1.6m height. MinimapPanel uses 0.8s animated fly-to keeping current eye height.
- **Fix**: Match MinimapPanel strategy — keep current eye height, look at clicked point, animate 0.5s.
- **File**: `src/components/viewer/SplitPlanView.tsx` (lines 745-787)

### Issue 2: 3D/360° alignment precision
- **Root cause**: AlignmentPointPicker captures panorama tripod position, not the clicked surface point. Creates systematic offset.
- **Fix**: Use ray-cast or improved UX guidance. Add visual feedback markers in both views.
- **File**: `src/components/viewer/AlignmentPointPicker.tsx` (lines 69-93)

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
