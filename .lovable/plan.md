

## Plan: FM Access Hierarchy Auto-Creation via Sync + Vector Drawing Support

### Log Analysis

The latest FM Access sync logs confirm the pattern works: objects are looked up by GUID, get 400 "Object not found", then correctly created via POST. The sync flow is functional for individual assets.

### Key Changes from Original Plan

1. **No separate creation step** — building hierarchy (Fastighet → Byggnad → Plan → Rum) is created automatically during FM Access sync if the building doesn't already exist
2. **Vector graphics, not PDF** — drawings should be converted from IFC/XKT geometry to the vector format FM Access uses natively (SVG-based DXF or the HDC internal vector format), not PDF
3. **Test with "Stadshuset Nyköping"** — exists in Geminus but not in FM Access

---

### Part 1: Auto-Create Building Hierarchy During Sync

Currently `handleSyncToFmAccess` only syncs individual inventoried assets. The new flow:

```text
FM Access Sync button clicked
    │
    ▼
For each unique building_fm_guid in assets to sync:
    │
    ├─ Check if Byggnad exists in FM Access (GET /api/object/byguid)
    │
    ├─ If NOT found:
    │   ├─ Find/create Fastighet (classId 102) — use complex_common_name from local asset
    │   ├─ Create Byggnad (classId 103) under Fastighet
    │   ├─ For each level_fm_guid under building: Create Plan (classId 105)
    │   └─ For each in_room_fm_guid under plans: Create Rum (classId 107)
    │   └─ Store fm_access_building_guid in building_settings
    │
    ├─ If found: skip (already exists)
    │
    ▼
Then sync individual assets as before (existing logic)
```

#### File: `supabase/functions/fm-access-query/index.ts`

Add new action `ensure-hierarchy`:
- Accepts `buildingFmGuid`, `buildingName`, `complexName`, `levels` (array of {fmGuid, name}), `rooms` (array of {fmGuid, name, levelFmGuid})
- First checks if the building exists by GUID in FM Access
- If not: discovers root perspective node, creates Fastighet (102), Byggnad (103), Plan (105), Rum (107) top-down
- Returns map of created GUIDs and what was created vs skipped
- Uses `systemGuid` field in POST payload to preserve the Geminus GUID

#### File: `src/services/fm-access-service.ts`

Add `ensureFmAccessHierarchy(buildingFmGuid: string)`:
- Queries local `assets` table for the building, its levels (category='Level'), and rooms (category='Space')
- Calls the new `ensure-hierarchy` action
- Updates `building_settings.fm_access_building_guid` on success

#### File: `src/components/settings/ApiSettingsModal.tsx`

Update `handleSyncToFmAccess`:
1. Before syncing individual assets, group them by `building_fm_guid`
2. For each unique building, call `ensureFmAccessHierarchy` first
3. Then proceed with individual asset sync as before
4. Update UI to show hierarchy creation progress (e.g., "Skapar byggnad 1 av 3...")

Remove the `fmAccessLocalCount === 0` disable condition — the sync button should work even if there are only buildings/floors/rooms to create (not just inventoried assets).

---

### Part 2: Vector Drawing Investigation & Conversion

#### Technical Research Needed

FM Access 2D viewer renders "Ritning" objects (classId 106). The HDC API has:
- `GET /api/drawings?buildingId=` — lists drawings
- `GET /api/drawings/{id}/pdf` — downloads as PDF (but this is export, not the native format)

The native format in HDC/Tessel is **DWG** (AutoCAD). The 2D viewer renders DWG files as vector graphics in a canvas. To upload drawings we need to:

1. **Discover the upload endpoint** — use the `proxy` action to probe `/api/drawings` with POST and `/api/drawings/upload`
2. **Convert IFC geometry to DWG or SVG** — extract 2D floor plan per storey from IFC

#### Proposed Conversion Pipeline

```text
IFC file (already parsed by web-ifc in browser)
    │
    ▼
Extract IfcBuildingStorey geometry
(walls, doors, windows projected to 2D plane)
    │
    ▼
Generate SVG per floor
(line segments, polylines, text labels)
    │
    ▼
Upload as Ritning (classId 106) under Plan in FM Access
(via HDC drawing upload API — needs endpoint discovery)
```

#### Phase A (this implementation): API Discovery

Add a `discover-drawing-api` action to fm-access-query that:
- Probes known drawing endpoints (`/api/drawings`, `/api/drawings/upload`, `/api/files/upload`)
- Returns available methods and expected payload format
- This is needed before we can implement upload

#### Phase B (follow-up): IFC → SVG extraction

- Use `web-ifc` (already available) to extract wall/door/window geometry per storey
- Project 3D coordinates to 2D (drop Z, rotate to plan view)
- Generate SVG with proper scale
- Upload via discovered API endpoint

---

### Files to Create / Modify

| File | Changes |
|---|---|
| `supabase/functions/fm-access-query/index.ts` | Add `ensure-hierarchy` action + `discover-drawing-api` action |
| `src/services/fm-access-service.ts` | Add `ensureFmAccessHierarchy()` function |
| `src/components/settings/ApiSettingsModal.tsx` | Update `handleSyncToFmAccess` to auto-create hierarchy before syncing assets; remove count=0 disable |

### Implementation Order

1. Add `ensure-hierarchy` action to edge function (creates Fastighet→Byggnad→Plan→Rum with classIds)
2. Add `ensureFmAccessHierarchy` to service layer
3. Update sync handler to call hierarchy creation per building before asset sync
4. Add `discover-drawing-api` action to probe drawing upload capabilities
5. Test end-to-end with "Stadshuset Nyköping"

