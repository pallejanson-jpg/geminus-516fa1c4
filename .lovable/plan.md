

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

---

## Plan: Remove Separate Technical Systems UI (IMPLEMENTED)

### Changes made
1. **Removed standalone Technical Systems UI** from `ApiSettingsModal.tsx` Sync tab:
   - Removed `SyncProgressCard` for Technical Systems
   - Removed IFC System Import panel (file upload, building selector, mode radio)
   - Removed state variables: `isSyncingSystems`, `systemSyncResult`, `ifcSystemFile`, `ifcSystemBuildingGuid`, `ifcSystemMode`, `isImportingIfcSystems`, `ifcSystemImportResult`, `ifcSystemBuildings`, `showIfcSystemImport`
   - Removed `handleSyncSystems` and `handleImportIfcSystems` functions
   - Added lightweight system count display in the sync status section

2. **Auto-trigger system sync** after existing flows:
   - After Asset+ asset sync completes → calls `sync-systems` automatically
   - After ACC BIM sync completes → calls `sync-systems` automatically
   - IFC flow already extracts systems in `ifc-to-xkt` edge function (no change needed)

3. **System count** shown inline in sync status when systems exist (no separate card)

---

## Plan: Move & Delete Objects in 3D Viewer (IMPLEMENTED - Phase 1)

### Database changes
- Added columns to `assets`: `modification_status` (text), `moved_offset_x/y/z` (numeric), `original_room_fm_guid` (text), `modification_date` (timestamptz)
- Partial index on `modification_status WHERE NOT NULL`

### Viewer changes
1. **`entityOffsetsEnabled: true`** in `NativeXeokitViewer.tsx` Viewer constructor
2. **`useObjectMoveMode` hook** — drag-move logic with:
   - World-space pick-surface delta calculation
   - AABB-based room detection at new position
   - Persists offset + `modification_status = 'moved'` + room changes to DB
   - Applies saved offsets & hides deleted entities on model load
   - ESC to cancel move
3. **Context menu** — Added "Flytta objekt", "Ta bort objekt", "Markera" (select fix)
4. **Filter panel** — New "Ändringar" section with toggles:
   - "Visa flyttade objekt" → orange colorization (`[1, 0.6, 0.1]`)
   - "Visa borttagna objekt" → red colorization (`[1, 0.2, 0.2]`), makes hidden deleted objects visible

### Still to implement
- **Rapport-export** — CSV export of all modified assets from Insights/Asset tab
- **Asset+ sync reset** — Clear `modification_status` when `source_updated_at` changes in `asset-plus-sync`
- **ContextMenuSettings panel** — Wire new items visibility to settings toggles

---

## Plan: Viewer Stability Fix (5 issues) — IMPLEMENTED

### 1. Empty Properties Dialog + Close Button
- Added case-insensitive GUID matching (try original, lowercase, uppercase)
- BIM metadata fallback: when no local asset found, reads metaObject from xeokit viewer (type, name, floor, property sets)
- Added explicit X close button in desktop header (alongside ArrowLeft)
- Properties dialog now opens even without fmGuid (uses entityId for BIM fallback)

### 2. Unified Context Menu
- All entity-specific items always shown, but disabled (grayed out) when no entity is picked
- Separator between entity and global items
- NativeViewerShell always passes all handlers (no conditional `undefined`)
- Result: one consistent menu structure regardless of pick result

### 3. 2D Mode Button Reliability
- Added "force reapply" logic: re-clicking 2D when already in 2D re-runs clipping
- Floor ID cached in sessionStorage for recovery when floor context is lost during switch
- `mode2dTransitionRef` properly cleared in finally block to prevent stuck transitions

### 4. Insights Floor Coloring Accuracy
- Removed `slice(0,6)` limit on energyByFloor — all floors shown
- Deduplicated floors by base name (strips " - 01" suffix from model copies)
- Bar click resolves ALL matching storey GUIDs (across model copies) → only rooms on that floor colored
- Changed click mode from `room_spaces` to `energy_floor` for strict guid matching
- NativeXeokitViewer: `energy_floor` mode uses strict GUID matching (no name-based fallback)

### 5. Room Labels Performance
- Adaptive occlusion throttling: interval scales with label count (5 frames for <40, 10 for <80, 15 for 80+)
- Auto-disables occlusion when label count exceeds 150
- Viewport culling: labels outside canvas bounds + 50px margin are hidden early (before occlusion pick)
