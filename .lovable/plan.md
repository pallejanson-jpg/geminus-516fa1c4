

# Plan: Resumable Structure Sync

## Summary

Make `sync-structure` resumable using the same pattern as `sync-assets-resumable`: track progress in `asset_sync_progress`, return `{ interrupted: true }` before timeout, and let the frontend loop until done.

## Changes

### 1. Edge Function: `supabase/functions/asset-plus-sync/index.ts`

**Replace the monolithic `sync-structure` block (lines 745-826) with a two-phase resumable approach:**

- **Phase 1 — Upsert**: Fetch structure objects (types 1,2,3) in pages of 200, with a 45s timeout guard. Track progress in `asset_sync_progress` with `job = 'structure_objects'`, storing `skip`, `total_synced`, `phase` ('upsert' or 'cleanup'). If timeout approached, save progress and return `{ interrupted: true, phase: 'upsert' }`.

- **Phase 2 — Orphan cleanup**: When all pages fetched (collected remote fm_guids stored in a DB temp approach or re-fetched), compare against local non-ACC structure objects and delete orphans in batches. Also chunked with timeout guard. Return `{ interrupted: true, phase: 'cleanup' }` if needed.

- **Practical simplification**: Since remote fm_guids can't be held across invocations, split into:
  1. Upsert loop (resumable via skip) — runs until all pages done
  2. Orphan cleanup runs only in the final invocation after upsert completes — fetches remote count, compares with local count, and if mismatch does a single pass to identify and delete orphans (structure is ~2800 items, orphan detection is fast once upsert is done)

- On completion: delete progress row, set sync state to 'completed'.

- Add `'reset-structure-progress'` action mirroring `'reset-assets-progress'`.

### 2. Frontend: `src/components/common/DataConsistencyBanner.tsx`

Replace the single `sync-structure` call (lines 78-88) with a loop identical to the asset loop:

```typescript
const runStructureLoop = async () => {
  const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
    body: { action: 'sync-structure' }
  });
  if (error) throw error;
  if (data?.interrupted) {
    toast({ title: 'Syncing structure...', description: `${data.totalSynced} items so far...` });
    setTimeout(() => runStructureLoop(), 2000);
  } else {
    // Structure done, start asset loop
    toast({ title: 'Structure synced', description: `${data.totalSynced} items` });
    runAssetLoop();
  }
};
runStructureLoop();
```

### 3. SyncProgressBanner: `src/components/layout/SyncProgressBanner.tsx`

Update the auto-resume logic (lines 148-161) to also auto-resume stale `structure` syncs, not just `assets`.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/asset-plus-sync/index.ts` | Replace monolithic structure sync with resumable loop + orphan cleanup phase |
| `src/components/common/DataConsistencyBanner.tsx` | Loop structure sync until `interrupted: false` before starting assets |
| `src/components/layout/SyncProgressBanner.tsx` | Auto-resume stale structure syncs |

