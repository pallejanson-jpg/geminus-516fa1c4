

## Problem Analysis

The viewer filter menu shows only 3 levels for Småviken's A-model because:

1. **Stale data**: The `assets` table has only 3 storeys with `parentCommonName = 'A-modell'`, but Asset+ now has 8 (see uploaded screenshot: 01, 02, 03, 04-01, 04-02, 05-01, 06-01, TAKPLAN-02)
2. **Wrong source of truth**: `useFloorData` relies on xeokit metaScene to detect A-model storeys, but the XKT binary may not contain all storeys. The database `assets` table (populated from Asset+ sync) is the authoritative source
3. **Missing names in geometry_entity_map**: 2 of 4 A-model entries have `source_storey_name = NULL`, causing them to be skipped in name resolution

## Plan

### Step 1: Update `useFloorData` — use DB as authoritative A-model floor list

**File:** `src/hooks/useFloorData.ts`

Instead of relying solely on xeokit metaScene metaObjects filtered by A-model detection, add a **DB-driven floor list** that queries the `assets` table for storeys where `attributes->>'parentCommonName'` starts with "A" (case-insensitive). This becomes the primary floor source:

- Query `assets` table: `category = 'Building Storey'` filtered to rows where `parentCommonName` starts with A/a (matching `isArchitecturalModel` logic)
- Build `FloorInfo[]` from these DB records, using `common_name` or `attributes.levelName` for display names
- For each DB floor, attempt to find matching xeokit `metaObjectId` by comparing `fm_guid` against `metaObject.originalSystemId`
- If xeokit has no matching metaObject (model not loaded or storey absent from XKT), the floor still appears in the list but with an empty `metaObjectIds` array (graceful degradation)
- Merge non-A-model metaObjectIds into matching floors (existing Phase 2 logic preserved)

### Step 2: Fix `geometry_entity_map` storey name population

**File:** `supabase/functions/asset-plus-sync/index.ts`

In `upsertGeometryMappings`, the `source_storey_name` uses `item.commonName || item.designation`. For storeys where both are null, also try `item.levelName` (the field visible in the Asset+ screenshot):

```
source_storey_name: entityType === 'storey' 
  ? (item.levelName || item.commonName || item.designation || null) 
  : null
```

### Step 3: User action required

After deployment, the user must **re-sync structure** from Asset+ for Småviken to pull the updated `parentCommonName` assignments (where all 8 storeys are now tagged as A-modell).

## Technical Details

- The DB query in `useFloorData` will use the existing `supabase` client with a select like:
  ```sql
  SELECT fm_guid, common_name, attributes->>'levelName' as level_name,
         attributes->>'parentCommonName' as parent_model
  FROM assets
  WHERE building_fm_guid = ? AND category = 'Building Storey'
  ```
  Then filter client-side: `isArchitecturalModel(parent_model)`
- The xeokit metaScene scan remains as a secondary merge step to populate `metaObjectIds` for visibility toggling
- Sort order preserved: `name.localeCompare(b.name, 'sv')`

