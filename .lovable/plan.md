

## Plan: IFC System-Only Import + FMGUID Generation & Write-back

### Problem Summary
1. Asset+ doesn't store IFC system data — so `sync-systems` returns 0 for Asset+-synced buildings
2. Many IFC files lack FMGUIDs on objects — need to generate stable GUIDs and write them back to the IFC
3. Same GUID enrichment should work for ACC-sourced models

### Architecture

```text
┌─────────────┐     ┌──────────────────────┐     ┌─────────────┐
│  Settings UI │────▶│ ifc-extract-systems  │────▶│  systems    │
│  "Import     │     │  (new edge function) │     │  asset_system│
│   from IFC"  │     │                      │     │  assets      │
│              │     │  Modes:              │     │  external_ids│
│  File upload │     │  1. systems-only     │     └─────────────┘
│  + building  │     │  2. full (→ifc-to-xkt)│
│  selector    │     │  3. enrich-guids     │     ┌─────────────┐
└─────────────┘     │                      │────▶│ ifc-uploads  │
                    │  FMGUID generation:  │     │ (enriched    │
                    │  • Detect missing    │     │  IFC archive)│
                    │  • Generate stable   │     └─────────────┘
                    │  • Write to IFC props │
                    │  • Re-upload IFC     │
                    └──────────────────────┘
```

---

### 1. New Edge Function: `ifc-extract-systems`

**Input:** `{ ifcStoragePath, buildingFmGuid, mode, jobId? }`

**Modes:**
- `systems-only` — Parse IFC metadata, extract systems/connections, reconcile with existing assets, skip XKT. Fast (~10-15s).
- `enrich-guids` — Parse IFC with `web-ifc`, detect objects missing FMGUID property, generate deterministic UUIDs (based on IFC GlobalId), write FMGUID as a new IfcPropertySingleValue back into the IFC model via `web-ifc` API, re-serialize and upload the enriched IFC to `ifc-uploads` bucket as an archive copy. Also extract systems.
- `full` — Redirect to existing `ifc-to-xkt` (or call it internally).

**FMGUID Generation Strategy:**
- Check each `IfcBuildingStorey`, `IfcSpace`, `IfcElement` for existing `FMGUID` property
- If missing: generate `uuid5(namespace, ifcGlobalId)` for deterministic, reproducible GUIDs
- Use `web-ifc` `WriteLine` / property writing API to inject `FMGUID` as a new property into a "Geminus" property set on each object
- Re-export the IFC using `web-ifc`'s `SaveModel` / `ExportFileAsIFC`
- Upload enriched IFC to `ifc-uploads/{buildingFmGuid}/enriched-{timestamp}.ifc`
- Upsert all generated FMGUIDs into `assets` table (Building, Level, Space, Instance)
- Store IFC GlobalId → FMGUID mapping in `asset_external_ids`

**GUID Reconciliation for existing buildings:**
1. Exact GUID match: IFC GlobalId exists in `asset_external_ids.external_id` → use existing `fm_guid`
2. Name+type match: Match `IfcBuildingStorey` by name against `assets` with matching `building_fm_guid`
3. Generate new: Create new FMGUID, insert into `assets` and `asset_external_ids`

**System extraction** reuses existing `extractSystemsAndConnections()` logic (copied from `ifc-to-xkt`).

---

### 2. ACC FMGUID Enrichment

Extend `acc-sync` with a new action `enrich-guids`:
- For each BIM element synced from ACC that lacks an FMGUID in local `assets`
- Generate `uuid5(namespace, accExternalId)` 
- Store in `assets` table and `asset_external_ids` (source: `acc`)
- Optionally write back to ACC via the Properties API (if 3-legged token available and write scope granted)

This uses the same deterministic UUID strategy so re-syncs produce identical GUIDs.

---

### 3. UI Changes in `ApiSettingsModal.tsx`

Add to the "Technical Systems" `SyncProgressCard`:

**"Import from IFC" button** that opens an inline section:
- **Building selector** dropdown (existing buildings from `assets` where category = 'Building')
- **File input** for IFC upload
- **Mode radio:**
  - "Only systems (fast)" → `systems-only`
  - "Systems + generate FMGUIDs" → `enrich-guids`  
  - "Full conversion (systems + 3D)" → redirects to existing IFC upload flow
- **Progress bar** via `conversion_jobs` polling (same pattern as IFC-to-XKT)
- Shows result: systems found, GUIDs generated, enriched IFC download link

---

### 4. IFC Archive

Store enriched IFC files in `ifc-uploads` bucket under `{buildingFmGuid}/enriched/` path. The UI can show a list of archived IFC files per building with download links, allowing users to retrieve the GUID-enriched versions.

---

### 5. Database Changes

No new tables needed. Existing tables cover all requirements:
- `systems` + `asset_system` — system data
- `asset_external_ids` — IFC GlobalId ↔ FMGUID mapping
- `assets` — spatial hierarchy with generated FMGUIDs
- `conversion_jobs` — progress tracking

---

### 6. `web-ifc` Property Write-back

The `web-ifc` library supports writing properties back to an IFC model:
```typescript
// Pseudocode for FMGUID injection
const ifcApi = new WebIFC.IfcAPI();
ifcApi.Init();
const modelID = ifcApi.OpenModel(ifcData);

// For each element missing FMGUID:
// 1. Create IfcPropertySingleValue with name "FMGUID" 
// 2. Add to/create IfcPropertySet "Geminus_Identifiers"
// 3. Link via IfcRelDefinesByProperties

const enrichedIfc = ifcApi.ExportFileAsIFC(modelID);
// Upload enrichedIfc to storage
```

This is the key technical risk — `web-ifc` write support in Deno edge functions needs validation. If write-back fails, the function still succeeds for system extraction and GUID generation in the database; the IFC re-export becomes a best-effort feature.

---

### Implementation Order

1. **`ifc-extract-systems` edge function** with `systems-only` mode (immediate value)
2. **UI** in ApiSettingsModal for IFC upload + building selector + mode picker
3. **`enrich-guids` mode** with FMGUID generation + database persistence
4. **IFC write-back** using `web-ifc` property injection + re-upload
5. **ACC `enrich-guids` action** in `acc-sync`

