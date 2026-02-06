
# Fix Data Discrepancy Banner (180 Orphan Objects)

## Root Cause Analysis

The banner shows **2,982 local** vs **2,802 in Asset+** -- a difference of **180 objects**. These are **real orphans**, not a false positive.

### What happened

180 Space (room) objects belong to **two buildings that no longer exist in Asset+** (building GUIDs `b1148a3b-...` with 179 rooms and `815eff21-...` with 1 room). These buildings were removed from Asset+ but their rooms remain locally because:

1. The **regular structure sync** (`sync-structure`) only **upserts** -- it never deletes objects removed from the remote source
2. The **cleanup action** (`sync-with-cleanup`) does handle orphan removal and works correctly, but it runs as a separate action
3. The **"Synka & rensa" button** on the banner triggers `sync-with-cleanup`, which should fix it. However, the edge function takes ~45-60 seconds to fetch all 2,802+ remote GUIDs for comparison, which may cause timeouts in the client

### Why the banner keeps reappearing

The `dismissed` state is stored in React state only -- it resets every time the component remounts (page navigation, refresh). So even if the user clicks "Ignorera", the banner reappears on next visit.

## Fix Plan

### 1. Make the regular sync-structure also clean up orphans

Modify the `sync-structure` action in the edge function to track all fetched remote `fmGuids` during sync and delete local objects not found remotely (same logic as `sync-with-cleanup`). This way, every structure sync automatically cleans orphans instead of requiring a separate action.

**File:** `supabase/functions/asset-plus-sync/index.ts`

Changes to the `sync-structure` block (lines ~608-647):
- Collect all remote fmGuids into a Set during the pagination loop (same as sync-with-cleanup)
- After the upsert loop completes, query local non-is_local structure objects
- Delete any local objects whose fmGuid is not in the remote set
- Log orphan removal count

### 2. Persist banner dismissal in localStorage

Modify `DataConsistencyBanner.tsx` to store dismissal in `localStorage` with a time-based expiry (e.g., 24 hours). This prevents the banner from reappearing on every page navigation while still re-checking periodically.

**File:** `src/components/common/DataConsistencyBanner.tsx`

Changes:
- On dismiss, store `{ dismissedAt: Date.now() }` in localStorage key `data-consistency-dismissed`
- On mount, check localStorage -- if dismissed less than 24 hours ago, don't show
- After a successful sync-with-cleanup, clear the localStorage entry

### 3. Immediately clean up the 180 existing orphans

Since the edge function uses the service role key (bypasses RLS), the `sync-with-cleanup` action can delete the orphans right now. The fix to `sync-structure` will prevent future orphans from accumulating.

We will trigger a cleanup by calling `sync-with-cleanup` once the updated function is deployed.

## Technical Details

### Edge function changes (`asset-plus-sync/index.ts`)

The `sync-structure` action (lines 608-647) will be extended with orphan cleanup logic:

```
sync-structure flow (updated):
  1. Paginate through all Asset+ structure objects (objectType 1,2,3)
  2. Upsert each batch to local DB (existing behavior)
  3. Collect all remote fmGuids into a Set (new)
  4. After loop: query local structure objects where is_local=false (new)
  5. Delete any local objects not in remote Set (new)
  6. Log and include orphan count in response (new)
```

### Banner changes (`DataConsistencyBanner.tsx`)

```
Mount behavior (updated):
  1. Check localStorage for recent dismissal (< 24h)
  2. If recently dismissed, don't check or show
  3. Otherwise, run check-delta as before

Dismiss behavior (updated):
  1. Set dismissed=true in state
  2. Store dismissedAt timestamp in localStorage

After successful sync:
  1. Clear localStorage dismissal
  2. Re-check delta after 2s delay (existing behavior)
```

### Implementation order

| Step | Task | File |
|------|------|------|
| 1 | Add orphan cleanup to sync-structure action | `supabase/functions/asset-plus-sync/index.ts` |
| 2 | Add localStorage persistence for banner dismissal | `src/components/common/DataConsistencyBanner.tsx` |
| 3 | Deploy and trigger sync-with-cleanup to clear existing orphans | Edge function deployment |
