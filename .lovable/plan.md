

## Analysis of Issues

### 1. Delete Building Error (Red Toast)
The `asset-plus-delete` edge function's cleanup loop tries to delete from `bcf_issues`, `building_external_links`, and `fm_access_dou` tables. While these tables exist, the error likely comes from one of them failing silently or the edge function returning `success: false` when `expireErrors.length > 0` (line 231) — meaning the Asset+ ExpireObject API call fails for some objects. The `handleDeleteBuilding` in `CreateBuildingPanel.tsx` then shows a destructive toast with "Partially failed". Additionally, `geometry_entity_map` and `systems` table rows are not cleaned up during delete.

**Fix**: Add missing cleanup tables (`geometry_entity_map`, `systems`) and make the delete function more resilient — catch errors per-table so one failure doesn't block others. Also handle the case where Asset+ credentials aren't configured (skip expiry gracefully).

### 2. Expired Buildings in Asset+ Sync
The sync filter (`objectType = 1, 2, 3`) does **not** filter out expired objects from Asset+. The Asset+ API likely returns objects with an `expireDate` field. We need to add a filter condition like `["expireDate", "=", null]` to exclude expired buildings/objects.

**Fix**: Add expireDate filter to the `fetchAssetPlusObjects` calls in the sync-structure and sync-assets actions.

### 3. Property (Complex) Name in Building Selector
The viewer's `BuildingSelector.tsx` already shows `complexCommonName - buildingName` format (line 278-281). This works when the data has `complexCommonName`. No change needed there. But the `CreateBuildingPanel.tsx` building list likely doesn't show the complex name. Need to verify and add it.

### 4. Edit Building Properties Panel
The `CreatePropertyDialog` (Properties page) edits building_settings with API credentials and location. But for editing building **names**, common names, Ivion site IDs, position, and other building-level settings, the existing panel is in `CreateBuildingPanel.tsx` (settings). The user wants a clear way to edit building names and settings. Currently `CreatePropertyDialog` handles this at the "Property" (Complex) level. We need to ensure building-level editing (name, position, Ivion site ID) is accessible — this is already partially in `useBuildingSettings.ts` and `CreateBuildingPanel.tsx`.

### 5. IFC Import — Rooms Not Appearing in Navigator, No BIM Model in Viewer
The logs show:
- ✅ Hierarchy populated: 8 levels, 9 spaces (from server-side metadata-only extraction)
- But browser conversion reported: "Hierarchy: 0 levels, 0 spaces"
- XKT was generated (17.18 MB) and uploaded
- `xkt_models` row was created

**Root cause analysis**:
- The XKT file was uploaded and a `xkt_models` record was created with `model_id: ifc-{timestamp}` 
- The viewer fetches from `xkt_models` and loads via signed storage URL
- Rooms ARE in the database (8 levels, 9 spaces from server extraction)
- But the user says rooms don't show in Navigator — this could be a data refresh issue (AppContext not re-fetching after import)
- No BIM model visible — the XKT was uploaded but the viewer might not find it if the `storage_path` or `model_id` format doesn't match expectations

**Key issue**: After IFC import, the app needs to refresh its data. The navigator reads from `AppContext.navigatorTreeData` which loads from the `assets` table. After import, this data isn't refreshed. Also, the viewer needs to find the XKT model via the `xkt_models` table.

## Plan

### Task 1: Fix Delete Building Error
**File: `supabase/functions/asset-plus-delete/index.ts`**
- Add `geometry_entity_map` (column: `building_fm_guid`) and `systems` (column: `building_fm_guid`) to the cleanup tables list
- Wrap each cleanup table deletion in individual try/catch so one failure doesn't affect others
- If Asset+ credentials aren't configured, skip the expire step gracefully instead of failing
- Log which specific table caused the error

### Task 2: Filter Expired Objects from Asset+ Sync
**File: `supabase/functions/asset-plus-sync/index.ts`**
- In the structure sync filter (line 818-822), add `["expireDate", "=", null]` condition to exclude expired buildings/floors/rooms
- In the asset sync filter, add the same expireDate filter
- In the orphan cleanup filter, also exclude expired objects from the remote set

### Task 3: Show Complex (Property) Name in Building Selector Lists
**File: `src/components/viewer/BuildingSelector.tsx`** — Already done (line 278-281)
**File: `src/components/settings/CreateBuildingPanel.tsx`** — Update the building list to show `complexCommonName - buildingName` format. Currently fetches from `assets` table with `category = Building` but may not include `complex_common_name`.

### Task 4: Ensure Building Editing Panel is Accessible
The `CreatePropertyDialog` handles Complex/Property-level editing. For building-level settings (name, position, Ivion site ID, hero image, etc.), the functionality exists in `useBuildingSettings.ts` and is partially surfaced in `CreateBuildingPanel.tsx`. 
- Add building name editing (common_name) to the building panel in `CreateBuildingPanel.tsx`
- Ensure Ivion site ID, position, and other building settings are editable from the selected building's accordion section

### Task 5: Fix IFC Import — Navigator Refresh + XKT Model Loading
**File: `src/components/settings/CreateBuildingPanel.tsx`**
- After successful IFC conversion, dispatch a custom event to trigger AppContext data refresh so Navigator shows the new levels/rooms
- Verify the `xkt_models` upsert creates a record that the viewer can find and load

**File: `src/context/AppContext.tsx`** (if needed)
- Ensure it listens for a refresh event after IFC import

The core issue is likely that after IFC import completes, the Navigator tree isn't refreshed. The XKT model should load since it's stored correctly in `xkt_models` — but the viewer needs to be opened/refreshed after import.

### Technical Details

| File | Change |
|---|---|
| `supabase/functions/asset-plus-delete/index.ts` | Add missing cleanup tables, improve error resilience |
| `supabase/functions/asset-plus-sync/index.ts` | Add `expireDate = null` filter to exclude expired objects |
| `src/components/settings/CreateBuildingPanel.tsx` | Show complex name in list, add building name editing, trigger data refresh after IFC import |
| `src/context/AppContext.tsx` | Listen for data refresh event (if not already present) |

