## Plan: IFC → Assets Pipeline med GUID-generering, tillbakaskrivning och diff-hantering (IMPLEMENTED)

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
