

## Plan: System Support + Reconciliation Engine (IMPLEMENTED)

### Database tables created
1. **`asset_external_ids`** — Maps external IDs (IFC GUID, ACC externalId, Revit UniqueId) to stable `fm_guid` for cross-source reconciliation
2. **`systems`** — Technical systems (e.g., LB01 Supply Air) with `fm_guid`, `discipline`, `system_type`, `building_fm_guid`, hierarchical `parent_system_id`
3. **`asset_system`** — Many-to-many relation between assets and systems with optional `role`
4. **`asset_connections`** — Topology/flow between assets (`from_fm_guid` → `to_fm_guid`) with `connection_type` and `direction`

All tables have RLS: authenticated read, admin write. Indexes on common query patterns.

### Edge function changes
1. **`ifc-to-xkt/index.ts`** — Extended with system extraction:
   - Identifies `IfcSystem` / `IfcDistributionSystem` meta objects
   - Falls back to `SystemName` property grouping
   - Extracts `IfcRelConnects*` for topology → `asset_connections`
   - Stores all object IDs in `asset_external_ids`
   - Persists systems, asset-system links, and connections in batches

2. **`acc-sync/index.ts`** — Extended with system support:
   - Resolves `System Name`, `System Type`, `System Classification`, `System Abbreviation` property fields
   - Groups instances by `SystemName` → auto-creates `systems` + `asset_system` rows
   - Stores ACC `externalId` mappings in `asset_external_ids` for all levels, rooms, instances
   - Infers discipline from system name (Ventilation, Heating, Cooling, Electrical, Plumbing, FireProtection)

### System activation for existing buildings
- **ACC-byggnader**: Kör en ny ACC-sync → systemdata extraheras automatiskt
- **IFC-byggnader**: Ladda upp IFC-filen igen → `ifc-to-xkt` extraherar system
- **Asset+-byggnader**: Kör `sync-systems` action via `asset-plus-sync` edge function → extraherar system från befintliga attribut (IMPLEMENTERAT)

### Frontend (future phase)
- System tab on FacilityLandingPage
- System badge on asset property dialogs
- Manual system creation dialog

---

## Plan: Viewer Color Fix (IMPLEMENTED)

### Changes made:
1. **Window color** — Changed from blue-gray `[0.392, 0.490, 0.541]` (#647D8A) to neutral warm gray `[0.780, 0.780, 0.760]` (#C7C7C2) in:
   - `src/lib/architect-colors.ts`
   - `src/hooks/useArchitectViewMode.ts`
   - Database `viewer_themes` table (both "Arkitektvy" and "Standard" themes)
   - `ViewerFilterPanel.tsx` category palette

2. **Space color** — Verified as correct neutral gray `[0.898, 0.894, 0.890]` (#E5E4E3). Changed category palette in ViewerFilterPanel from blue to neutral.

3. **Background** — Already correct gray gradient in NativeViewerShell.

4. **A-model priority** — Already implemented in NativeXeokitViewer and useXktPreload.

5. **XKT per-floor split** — `xkt-split` edge function exists but only creates virtual chunks. Real binary split is Phase 2.

---

## Plan: IFC System-Only Import (IMPLEMENTED - Phase 1)

### What was built
1. **`ifc-extract-systems` edge function** — New lightweight edge function that:
   - Downloads IFC from `ifc-uploads` bucket
   - Parses metadata via `web-ifc` + `xeokit-convert` (same pipeline as `ifc-to-xkt`)
   - Extracts systems (`IfcSystem`, `IfcDistributionSystem`, `SystemName` property grouping)
   - Extracts connections (`IfcRelConnects*`)
   - Reconciles IFC GUIDs with existing assets (3-step: exact match → name match → identity)
   - Persists to `systems`, `asset_system`, `asset_connections`, `asset_external_ids`
   - **Skips XKT generation** — much faster (~10-15s vs minutes)
   - Supports 3 modes: `systems-only` (default), `enrich-guids` (future), `full` (delegates to `ifc-to-xkt`)

2. **UI in ApiSettingsModal** — "From IFC" button on the Technical Systems card:
   - Building selector dropdown
   - IFC file upload
   - Mode radio: "Only systems (fast)" / "Systems + FMGUIDs (coming soon)" / "Full conversion"
   - Progress tracking and result display

### Still to implement
- **`enrich-guids` mode** — FMGUID generation + IFC write-back via `web-ifc` property injection
- **IFC archive** — Store enriched IFC in `ifc-uploads/{buildingFmGuid}/enriched/`
- **ACC `enrich-guids` action** — Deterministic GUID generation for ACC-sourced models
