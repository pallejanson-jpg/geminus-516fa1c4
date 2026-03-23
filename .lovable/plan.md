

## Plan: Fix Sync Banner Confusion + Translate to English

### Problems Identified

1. **SyncProgressBanner is entirely in Swedish** — "Synkar", "Avbruten", "Fortsätt", "Återställ", "Synk klar", "Synkfel", "objekt", etc. were never translated.

2. **Two banners trigger overlapping syncs** — When `DataConsistencyBanner` fires `sync-with-cleanup`, it internally runs `sync-assets-resumable` which creates a `running` state in `asset_sync_state`. The `SyncProgressBanner` sees this, and also auto-resumes the same job after 3 seconds. Result: duplicate concurrent API calls, double spinners, and the edge function timing out with a red toast.

3. **`sync-with-cleanup` times out** — This action does structure sync + full asset sync sequentially in one edge function invocation, which exceeds the ~50s timeout for large datasets (54k+ assets). The timeout produces the `FunctionsFetchError` / "Load failed" red toast.

### Solution

#### 1. Translate SyncProgressBanner to English
All UI strings in `SyncProgressBanner.tsx`:
- "Synken har stannat" → "Sync stalled"
- "Synkar" → "Syncing"
- "Avbruten" → "Interrupted"
- "Fortsätt" → "Resume"
- "Återställ" → "Reset"
- "objekt" → "items"
- Toast: "Synkfel" → "Sync error"
- Toast: "Synk klar" → "Sync complete"
- Toast: "tillgångar synkade" → "assets synced"
- Toast: "Fortsätter synk" → "Resuming sync"
- Toast: "Återställd" → "Reset"
- Toast: "Kunde inte återställa" → "Reset failed"

#### 2. Prevent duplicate sync triggers
**In `SyncProgressBanner.tsx`:**
- Remove the auto-resume `useEffect` (lines 220-229). Auto-resuming silently is confusing — users should explicitly choose to resume or the `DataConsistencyBanner` handles it.

**In `DataConsistencyBanner.tsx`:**
- Before starting `syncWithCleanup`, dispatch an event (`sync-cleanup-started`) so `SyncProgressBanner` knows not to auto-trigger.
- After `syncWithCleanup` completes or fails, the banner already handles state correctly.

#### 3. Consolidate into a single sync experience
**Merge the two banners' concerns:**
- `SyncProgressBanner` becomes **display-only** — it shows real-time progress from `asset_sync_state` / `asset_sync_progress` tables, with Resume/Reset only for genuinely stale jobs (no auto-resume).
- `DataConsistencyBanner` remains the **trigger point** — it initiates sync and shows the discrepancy warning.
- When `DataConsistencyBanner` triggers a sync, `SyncProgressBanner` picks it up via realtime subscription and shows progress. No duplicate calls.

#### 4. Handle edge function timeout gracefully
**In `DataConsistencyBanner.syncWithCleanup`:**
- Instead of calling `sync-with-cleanup` (which does everything in one call and times out), call `sync-structure` first, then trigger `sync-assets-resumable` in a loop (same pattern as `SyncProgressBanner.handleResume`).
- This matches the resumable pattern that already works for 54k+ assets.

### Files Modified
| File | Changes |
|---|---|
| `SyncProgressBanner.tsx` | Translate all Swedish → English; remove auto-resume effect |
| `DataConsistencyBanner.tsx` | Replace `sync-with-cleanup` with sequential `sync-structure` + resumable asset sync loop |

### Scope
- 2 files modified
- No database changes
- No new files

