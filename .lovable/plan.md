

# Plan: Per-Building Sync + Incremental Date-Based Optimization

## Summary

Add per-building sync support and incremental sync using Asset+ modification dates to dramatically reduce sync time for subsequent runs.

## Changes

### 1. Per-Building Sync (`supabase/functions/asset-plus-sync/index.ts`)

Add optional `buildingFmGuid` parameter to `sync-assets-resumable`. When provided, only sync that single building instead of looping all buildings.

```typescript
// In sync-assets-resumable handler:
const targetBuilding = body?.buildingFmGuid;
const filteredBuildings = targetBuilding 
  ? buildings.filter(b => b.fm_guid === targetBuilding)
  : buildings;
```

### 2. Incremental Sync Based on Dates

**Database migration:** Add `last_asset_sync_at` column to `building_settings` table.

**Sync logic changes:**
- Before syncing a building, check `last_asset_sync_at` from `building_settings`
- If set and `force !== true`, add filter: `["modificationDate", ">", lastSyncAt]`
- After completing a building, update `last_asset_sync_at`
- If the incremental fetch returns 0 results, skip immediately (building is up to date)

### 3. Quick Count Check

Before fetching any objects for a building, do a count-only query to Asset+ and compare with local count. If they match and no `force` flag, skip entirely.

### 4. UI: Trigger Per-Building Sync

In `AssetsView.tsx` and `CreateBuildingPanel.tsx`, when syncing assets for a specific building, pass `buildingFmGuid` to the edge function instead of triggering a full sync.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/asset-plus-sync/index.ts` | Per-building filter, incremental date filter, count-check skip |
| `src/services/asset-plus-service.ts` | Pass `buildingFmGuid` in sync calls |
| DB migration | Add `last_asset_sync_at` to `building_settings` |

## Expected Impact

- First sync: same as today (full pull)
- Subsequent syncs: skip buildings with matching counts, only fetch modified objects — reducing from minutes to seconds for unchanged buildings

