

## Analysis: IFC and ACC Asset/Property Handling

### Current State

**IFC Import — Assets:**
- The server-side `ifc-to-xkt` edge function DOES populate assets into the `assets` table via `populateAssetsFromMetaObjects()` — it creates storeys, spaces, AND instances (Pass 3, lines 402-422). All non-spatial, non-relationship IFC objects are inserted as `category: "Instance"` with their `asset_type` set to the IFC type (e.g. `IfcWall`, `IfcDoor`).
- The browser-side path in `CreateBuildingPanel.tsx` only extracts levels/spaces and triggers a server fallback for hierarchy — it does NOT populate instances from the browser path. It relies on the server `ifc-to-xkt` function for that.

**IFC Import — Properties: GAP**
- IFC property sets (`propertySets` on metaObjects) are **NOT mapped to the `attributes` column** on the `assets` table. The `populateAssetsFromMetaObjects` function only stores `fm_guid`, `name`, `common_name`, `category`, `asset_type`, and spatial references. No property data is persisted.
- Systems are extracted from property sets (SystemName), but individual object properties (e.g. area, material, manufacturer, fire rating) are discarded.

**ACC Import — Assets:**
- `upsertBimAssets()` in `acc-sync` DOES populate levels, rooms (with properties like area), AND instances into the `assets` table. Room properties are stored in `attributes.bim_properties`. Instance properties are minimal — only `bim_category`, `bim_external_id`, etc.

**ACC Import — Properties: PARTIAL**
- Room properties (area, perimeter, volume, department) are extracted and stored in `attributes.bim_properties`.
- Instance properties beyond category/name are NOT extracted — the Model Properties API returns all fields but only `systemName`, `systemType`, `level`, `room`, `typeName` are used.

**ACC Import — Missing Spaces:**
- The `extractBimHierarchy` function correctly looks for categories `Revit Rooms`, `Rooms`, `IfcSpace`. If the Model Properties API returns rooms under a different category name (e.g. a Swedish locale), they would be missed. The `categoryCounts` debug log (line 1010-1015) would reveal what categories exist.
- Another possibility: the Model Properties index isn't `FINISHED` yet (30s polling timeout), or the model version URN doesn't match. The code falls through silently with 0 rooms if the index isn't ready.

### Plan

#### 1. IFC Import: Store IFC Property Sets in `attributes`

**File: `supabase/functions/ifc-to-xkt/index.ts`** — `populateAssetsFromMetaObjects()`

- For each instance (and space), extract `propertySets` / `properties` from the metaObject
- Store them in the `attributes` JSON column as structured data (matching ACC's `bim_properties` format)
- For spaces: extract area, perimeter, volume if available and set `gross_area`

#### 2. IFC Browser Path: Populate Instances from Metadata

**File: `src/components/settings/CreateBuildingPanel.tsx`**

- After browser conversion succeeds and metadata JSON is uploaded, the server fallback (`ifc-extract-systems`) already recovers storeys/spaces but does NOT populate instances
- Add a step: after server metadata extraction, call `populateAssetsFromMetaObjects` (or the conversion-worker `populate-hierarchy` endpoint) with the full metadata to ensure instances are created
- Alternatively, trigger the full `ifc-to-xkt` server function in metadata-only mode to populate all assets

#### 3. ACC Import: Extract and Store Instance Properties

**File: `supabase/functions/acc-sync/index.ts`** — `extractBimHierarchy()` + `upsertBimAssets()`

- In the instance extraction loop (line 971-1007), collect ALL property fields from `obj.props` (not just category/name/level/room/system)
- Store them in `attributes.bim_properties` on the instance asset, matching the room property format
- Use `fieldsMap` to translate field keys to human-readable names

#### 4. ACC Import: Fix Missing Spaces

**File: `supabase/functions/acc-sync/index.ts`** — `extractBimHierarchy()`

- Add broader category matching for rooms: include `'Spaces'`, `'Rum'`, `'IfcSpace'`, and any category containing "Room" or "Space" (case-insensitive)
- Add diagnostic logging: log ALL category counts so we can see exactly what categories exist in the model
- Increase the polling timeout from 30s to 45s to handle slower index builds
- If rooms are still 0 after extraction, log a warning with available categories

#### 5. Browser IFC: Ensure Server Fallback Populates All Assets

**File: `supabase/functions/ifc-extract-systems/index.ts`**

- This function is the server fallback for browser conversions. Currently it extracts storeys/spaces but the space detection heuristic was just fixed. Verify it also calls asset population for instances from the metadata JSON — currently it does NOT populate instances, only storeys and spaces.
- Add instance population from the metadata objects (same logic as `populateAssetsFromMetaObjects` in `ifc-to-xkt`)

### Technical Details

| File | Change |
|---|---|
| `supabase/functions/ifc-to-xkt/index.ts` | Extract property sets from metaObjects, store in `attributes` column for instances and spaces |
| `supabase/functions/ifc-extract-systems/index.ts` | Add instance population from metadata; ensure all assets (not just hierarchy) are created |
| `supabase/functions/acc-sync/index.ts` | Broaden room category matching; extract full instance properties; increase poll timeout |
| `src/components/settings/CreateBuildingPanel.tsx` | After browser conversion, ensure server fallback populates instances too (not just hierarchy) |

