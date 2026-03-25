

# Analysis: Asset+ Sync Issues

## Current Status

**Structure sync**: Working correctly now. The resumable implementation completed successfully — 2809 items synced, 2826 orphans removed. Status is `completed`.

**Asset sync**: Stuck on building 15/19 (Småviken). The sync has been looping on this building for 7+ invocations, each time hitting the timeout at increasing skip values (100, 700, 1400, 2100, 2700, 3300, 3400). There is also a `statement timeout` error from the database (`canceling statement due to statement timeout`, error code 57014).

### Root Cause: Småviken Asset Sync

Småviken has **45,509 remote Instance objects** in Asset+. Each invocation fetches pages of ~200 and upserts them, but:

1. The upsert query for this many rows triggers a **Postgres statement timeout** (the first invocation logged this error)
2. Even without the DB timeout, the Edge Function only processes ~600-700 items before hitting its own 45s wall-clock timeout
3. At this rate, 45,509 items / 700 per invocation = **~65 invocations** needed just for Småviken
4. The sync IS progressing (skip went from 100 → 3400), but very slowly

The structure sync and asset sync do NOT run simultaneously — the `DataConsistencyBanner` correctly sequences them (structure loop finishes, then asset loop starts). The logs confirm structure completed at 05:02:36 and assets started at 05:02:44.

## Geometry Mappings

The `geometry_entity_map` table is **still actively used and relevant**. It has 6,369 rows across 10 buildings (4,119 for Småviken alone). It serves as the authoritative mapping layer for:

- **`useFloorData`** — storey name resolution (primary source)
- **`useModelData`** — model name resolution (primary source)
- **`useModelNames`** — canonical model name lookup
- **`viewer-manifest`** — entity-to-asset mapping for 3D viewer
- **`rebuild-geometry-map`** — backfill/repair tool

It is populated during IFC-to-XKT conversion and during Asset+ sync. This table should be kept.

## Recommendations

### Fix 1: Increase upsert batch efficiency for large buildings
The current upsert logic inserts assets one page at a time (200 items), each with a full `geometry_entity_map` upsert attempt. For a 45k-item building, this is too granular.

**Changes in `supabase/functions/asset-plus-sync/index.ts`**:
- Increase page size from 200 to 500 for asset sync
- Skip `geometry_entity_map` upsert during bulk sync (it's non-critical and causes the statement timeout) — run it as a separate post-sync step
- Add a per-building skip counter in `asset_sync_progress` so that when Småviken times out mid-way, the next invocation continues from the correct offset within that building (currently it restarts the building each time)

### Fix 2: Per-building pagination persistence
Currently `asset_sync_progress` tracks `skip` and `current_building_index` but the skip resets to 0 when resuming from building 15. The code should persist the intra-building skip so Småviken resumes at skip=3400 instead of starting over.

**Changes in `supabase/functions/asset-plus-sync/index.ts`**:
- Store `building_skip` in progress row alongside `skip` (global) 
- On resume, use `building_skip` for the current building

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/asset-plus-sync/index.ts` | Persist per-building skip; increase page size; defer geometry_entity_map upsert for large buildings |

