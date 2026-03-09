

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

---

## Plan: IFC → Geminus → IMDF Export Pipeline (PLANERAD)

### Översikt
Fullständigt flöde för att importera IFC, berika data i Geminus, och exportera till IMDF och andra format för konsumtion i externa system (Apple Maps Indoor, wayfinding-appar, IWMS/CAFM).

### Flöde

#### 1. IFC Import (redan implementerat)
- Användare laddar upp `.ifc` → `ifc-uploads` bucket
- `ifc-to-xkt`: konverterar till XKT för 3D-visning
- `ifc-extract-systems`: extraherar metadata, system, GUID-berikning
- `asset-plus-sync`: synkar till Asset+ API
- **Resultat i DB:** assets (rum med koordinater & area), building_settings (georeferens), systems/asset_connections

#### 2. Geminus — Berikning & Förvaltning (redan implementerat)
- Navigering i 3D/2D/360°
- Tillgångsregistrering (inventarier, brandredskap)
- Ärendehantering (BCF issues)
- Sensorkoppling (Senslinc)
- Dokument & ritningar (FM Access)
- AI-skanning för automatisk objektdetektering
- Rumskategorisering (office, restroom, corridor)
- All data berikas i DB: assets.category, asset_type, attributes, koordinater, annotationer, issues

#### 3. Export — IMDF + Andra Format (NY)

##### IMDF Export (ny edge function: `imdf-export`)
1. **venue.geojson** — Hämta byggnad från `building_settings` → namn, adress, WGS84-polygon
2. **level.geojson** — Hämta våningar (`assets WHERE category='Level'`) → ordinal, höjd
3. **unit.geojson** — Hämta rum (`assets WHERE category='Space'`):
   - Geometri: `web-ifc` snittar IfcSpace vid golvhöjd → 2D-polygon → WGS84-transform
   - category: mappa `asset_type` → IMDF-kategori (office, restroom, stairs, elevator)
   - name, alt_name från `common_name`
4. **opening.geojson** — Hämta dörrar (`assets WHERE category='Door'`) → position, rumskoppling
5. **anchor.geojson** — Hämta tillgångar med koordinater → brandredskap, sensorer
6. **manifest.json** + ZIP-paketering

##### Kritisk transformationslogik (steg 3 — unit.geojson)
```
IFC-fil (ifc-uploads bucket)
  → web-ifc: öppna modell, iterera IfcSpace
    → hämta geometri (GetFlatMesh)
      → extrahera vertices, trianglar
  → Horisontellt snitt vid golvhöjd (storeyAABB[y] + 0.1m)
    → intersektera alla trianglar med XY-plan
      → samla linjesegment → sluten polygon
  → Lokal → WGS84 transform (building_settings.latitude/longitude/rotation)
  → Output: GeoJSON Polygon per rum
```

##### Andra exportformat (framtida fas)
- **BCF-XML**: ärenden → openBIM-kompatibelt
- **COBie**: tillgångar → Excel/IFC för drift
- **GeoJSON**: enklare variant utan IMDF-schema
- **CSV**: tillgångslista för extern import

#### 4. Konsumenter
- **Apple Maps Indoor** → IMDF för inomhusnavigering
- **Wayfinding-appar** → IMDF/GeoJSON
- **IWMS/CAFM-system** → COBie/CSV
- **BIM-samordning** → BCF-XML tillbaka till Revit/Solibri
- **Kartplattformar** → GeoJSON till Mapbox/Google Maps
- **Digital Twin** → Allt ovan + realtidsdata via API

### Komponentstatus

| Komponent | Status |
|---|---|
| IFC-uppladdning & lagring | ✅ Finns |
| web-ifc i edge function | ✅ Finns (ifc-extract-systems) |
| Georeferens per byggnad | ✅ Finns (building_settings) |
| Rum med metadata | ✅ Finns (assets-tabellen) |
| Koordinattransform | ✅ Finns (coordinate-transform.ts) |
| **2D-polygonextraktion** | ❌ Ny — geometri-slicing |
| **IMDF-schema-generering** | ❌ Ny — GeoJSON-mappning |
| **ZIP-paketering** | ❌ Ny — edge function |
| **Export-UI i Geminus** | ❌ Ny — knapp i inställningar |

### Implementationsfaser
1. **Fas 1**: Metadata-only IMDF (venue, level, unit utan geometri — använd bounding box som polygon-approximation)
2. **Fas 2**: Geometri-slicing (web-ifc IfcSpace → 2D-polygoner)
3. **Fas 3**: Full IMDF med openings, anchors, occupants
4. **Fas 4**: Övriga exportformat (BCF-XML, COBie, CSV)
