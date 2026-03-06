

## Plan: System Sync UI Button + Full System Navigation MVP

This is a large feature spanning UI sync controls, a new navigation paradigm, 3D viewer integration, and multiple new panels. The plan is structured in phases.

---

### Phase 1: Sync Systems Button in Settings

**Where:** `ApiSettingsModal.tsx` — Sync tab, Asset+ accordion section, after the XKT Files `SyncProgressCard`.

**What:**
- Add a new `SyncProgressCard` for "Technical Systems" with a Network icon
- Add state: `isSyncingSystems`, `systemSyncResult`
- Add handler `handleSyncSystems` that calls `supabase.functions.invoke('asset-plus-sync', { body: { action: 'sync-systems' } })` with resumable loop (same pattern as assets/XKT sync)
- Fetch system count from `systems` table to show local count
- The edge function already supports `sync-systems` action and returns `{ systemsCreated, linksCreated, interrupted, progress }`

---

### Phase 2: System Navigation in Navigator

**Where:** `NavigatorView.tsx`

**What:**
- Add a toggle button to switch between **Spatial** (existing tree) and **System** navigation views
- System view fetches from `systems` table (with `asset_system` joins) and builds a tree:
  ```
  Systems
   └ Ventilation
       └ LB01 (12 assets)
       └ LB02 (8 assets)
   └ Heating
       └ H01 (6 assets)
  ```
- Group by `discipline` field → system name → assets
- Clicking a system dispatches the same 3D highlight event used by Insights (colorize system assets, dim rest)
- Clicking an asset navigates to its spatial location

---

### Phase 3: System Filter in ViewerFilterPanel

**Where:** `ViewerFilterPanel.tsx`

**What:**
- Add a new collapsible "Systems" section below Categories
- Fetch systems for the current building from `systems` + `asset_system` tables
- Each system row shows name, discipline badge, and asset count
- Checking a system: highlights its assets in full color, dims everything else (x-ray mode)
- Multiple systems can be checked simultaneously
- Uses `normalizeGuid` matching against `metaScene` entities

---

### Phase 4: System Properties Panel

**Where:** New component `src/components/viewer/SystemPropertiesPanel.tsx`

**What:**
- Triggered when a system is selected (from filter or navigator)
- Shows: System name, type, discipline, asset count, rooms served, floors spanned
- Lists all assets in the system with click-to-fly-to
- "Trace System" button that sequentially highlights assets following `asset_connections` topology

---

### Phase 5: System Tab on FacilityLandingPage

**Where:** `FacilityLandingPage.tsx`

**What:**
- Add a "Systems" section/tab showing all systems for the building
- Card per system: name, discipline icon, asset count, room count
- Click opens system detail or highlights in 3D
- System coverage view: which rooms each system serves

---

### Phase 6: System Highlight in 3D

**Where:** `NativeViewerShell.tsx` / `NativeXeokitViewer.tsx`

**What:**
- New event `SYSTEM_HIGHLIGHT_EVENT` in `viewer-events.ts`
- When fired with system asset FMGUIDs:
  - Set all non-system entities to 20% opacity (x-ray)
  - Set system entities to full color with category-based palette
- Reset event restores normal view
- Works with existing `recolorArchitectObjects` infrastructure

---

### Phase 7: System Topology Graph (Advanced)

**Where:** New component `src/components/viewer/SystemTopologyView.tsx`

**What:**
- Uses `asset_connections` table data (from_fm_guid → to_fm_guid, direction)
- Renders a simple directed graph/tree showing flow direction
- Split view: `[3D View] | [System Diagram]`
- Click node in graph → fly to entity in 3D
- Future: animate flow direction

---

### Phase 8: System Heatmaps (IoT Integration)

**Where:** Extends existing Senslinc integration

**What:**
- When a system is selected and IoT data exists, color components by sensor status
- Green = normal, Yellow = warning, Red = alarm
- Leverages existing `INSIGHTS_COLOR_UPDATE_EVENT` infrastructure
- System KPI panel: aggregated metrics (total flow, energy, efficiency)

---

### Phase 9: Cross-Navigation

**What:**
- From any asset property dialog, show "Part of System: LB01" with clickable link
- From system view, click asset → navigate to spatial location (room, floor)
- Bidirectional: Spatial → System and System → Spatial

---

### Technical Notes

- All system data comes from existing `systems`, `asset_system`, and `asset_connections` tables (already created)
- The `sync-systems` edge function already exists and is resumable
- Entity matching in 3D uses `normalizeGuid` on `fm_guid` ↔ `originalSystemId`
- No new database tables needed for the MVP (phases 1-6)
- Phase 7 (topology) may benefit from a lightweight graph rendering library or simple SVG/CSS tree

### Implementation Order

Recommend implementing in this order: **Phase 1 → 3 → 6 → 2 → 4 → 5 → 9 → 7 → 8**

Phase 1 (sync button) is the immediate request and can ship standalone.

