

# Plan: Smart Sync with User Choice

## Summary

When a sync completed recently (within 5 minutes), show the user a choice instead of silently skipping or blindly re-running. The user can either accept "already synced" or force a full re-sync. All UI text in English.

## Changes

### 1. Edge Function: `supabase/functions/asset-plus-sync/index.ts`

At the top of the `sync-structure` handler, before fetching any data:

- Query `asset_sync_state` for the `structure` row's `completed_at` and `status`.
- If `status === 'completed'` and `completed_at` is within 5 minutes, AND the request body does NOT include `force: true`, return:
  ```json
  { "success": true, "interrupted": false, "skipped": true, "totalSynced": 0, "message": "Structure synced recently" }
  ```
- If `force: true` is passed, proceed with the full sync as normal.

Same logic for `sync-assets-resumable`: check the `assets` row in `asset_sync_state`. If completed within 5 minutes and not forced, return `{ skipped: true }`.

### 2. Frontend: `src/components/common/DataConsistencyBanner.tsx`

Update `syncWithCleanup` to handle the `skipped` response:

- When `runStructureLoop` gets `data.skipped === true`, instead of immediately proceeding, show a **toast with an action button**:
  ```
  Title: "Already synced"
  Description: "Structure was synced recently. Values may already be up to date."
  Action button: "Sync anyway" → re-calls with force: true
  ```
- If the user doesn't click "Sync anyway", proceed directly to the asset loop (which will also check its own skip guard).
- When `runAssetLoop` also returns `skipped`, show a completion toast: "Everything is up to date" and stop.
- Pass `force` flag through: `body: { action: 'sync-structure', force: forceRef.current }`.

**Flow:**
```text
User clicks "Sync with Asset+"
  → structure call (force: false)
    → skipped? Show toast "Already synced" + "Sync anyway" button
       → User ignores: proceed to asset loop
       → User clicks "Sync anyway": restart with force: true
    → not skipped? Normal resumable loop
  → asset call (force: false)  
    → skipped? Toast "Everything is up to date", done
    → not skipped? Normal resumable loop
```

### 3. SyncProgressBanner: `src/components/layout/SyncProgressBanner.tsx`

No changes needed — the auto-resume logic already handles stale syncs, and the skip guard only applies to recent completions.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/asset-plus-sync/index.ts` | Add 5-min skip guard at top of `sync-structure` and `sync-assets-resumable`, bypassed by `force: true` |
| `src/components/common/DataConsistencyBanner.tsx` | Handle `skipped` response with toast + "Sync anyway" action; pass `force` flag |

