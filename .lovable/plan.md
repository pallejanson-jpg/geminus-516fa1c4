

## Problem Summary

Three issues to address:

1. **Poor sync feedback** -- During and after sync, users see only brief toasts. No persistent, detailed status panel showing what's happening step-by-step or a clear outcome summary.

2. **Structure sync auto-triggers asset sync** -- `handleSyncStructure` currently chains into `runResumableSync()` (assets) automatically. User wants these as two independent processes.

3. **Local objects not pushed to Asset+** -- After syncing from Asset+, local-only objects (`is_local: true`) should be pushed to Asset+ to maintain CRUD parity and avoid discrepancies.

## Plan

### 1. Create a shared SyncStatusLog component

**New file: `src/components/settings/SyncStatusLog.tsx`**

A reusable component that shows a persistent, scrollable log of sync steps with clear status indicators:

- Each step shows: icon (spinner/check/error), label, count, duration
- Sections for "Structure Sync" and "Asset Sync" with collapsible detail
- Final summary card after completion: "X buildings, Y floors, Z rooms synced" / "X assets synced, Y local objects pushed to Asset+"
- Error summary if any steps failed

This component will be used both in:
- `DataConsistencyBanner` (front page, inline expandable)
- `ApiSettingsModal` sync tab (always visible when sync is active)

### 2. Separate Structure and Asset sync in settings

**Edit: `src/components/settings/ApiSettingsModal.tsx`**

- `handleSyncStructure`: Remove the automatic chaining to `runResumableSync()`. After structure completes, show a clear summary and stop. Do NOT set `isSyncingAssets`.
- `handleSyncAssetsChunked`: Stays independent as-is.
- Both cards already exist separately in the UI -- just decouple the logic.

### 3. Separate sync in DataConsistencyBanner

**Edit: `src/components/common/DataConsistencyBanner.tsx`**

- Replace the single "Sync with Asset+" button with two buttons: "Sync Structure" and "Sync Assets"
- Or keep one button but show a step indicator making it clear which phase is running, and allow the user to trigger them independently
- Show the `SyncStatusLog` inline while syncing, replacing the current minimal toast-only feedback

### 4. Add "push local objects" step to asset sync

**Edit: `src/components/settings/ApiSettingsModal.tsx`**

- After asset sync completes (pull from Asset+), add a follow-up step that calls `push-missing-to-assetplus` action (already exists in the edge function) to push local-only objects to Asset+
- Show this as a distinct step in the SyncStatusLog: "Pushing X local objects to Asset+..."
- Update the summary to include pushed count

**Edit: `src/components/common/DataConsistencyBanner.tsx`**

- Same push-local step after sync completion

### 5. Enhance SyncProgressCard with outcome display

**Edit: `src/components/settings/SyncProgressCard.tsx`**

- Add an optional `lastResult` prop to show a summary after sync completes (e.g., "Synced 1,204 buildings/floors/rooms in 2m 15s")
- Show success/error state persistently until next sync starts

### Technical Details

- The edge function already supports `push-missing-to-assetplus` action -- no backend changes needed
- `SyncStatusLog` will use a simple `{step, status, message, count, startedAt, completedAt}[]` state array
- The log state will be lifted to a shared hook or passed via props so both banner and settings can display it
- Realtime subscriptions on `asset_sync_state` and `asset_sync_progress` tables will feed the log updates

### Files Changed

| File | Change |
|---|---|
| `src/components/settings/SyncStatusLog.tsx` | New -- reusable sync log/outcome component |
| `src/components/settings/ApiSettingsModal.tsx` | Decouple structure/asset sync, add push-local step, integrate SyncStatusLog |
| `src/components/common/DataConsistencyBanner.tsx` | Better progress UI, separate sync triggers, push-local step |
| `src/components/settings/SyncProgressCard.tsx` | Add lastResult/outcome display |
| `src/components/layout/SyncProgressBanner.tsx` | Update to show richer step info from SyncStatusLog |

