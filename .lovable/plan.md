
## Issues identified

1. **Auto-syncs run in the background** — `DataConsistencyBanner` (mounted in `AppLayout`) auto-invokes `asset-plus-sync` (`check-delta`) on every mount and can pop a sync banner. `useModelLoader` may also trigger sync on building open.

2. **Counts mismatch (4 140 local vs 3 379 in Asset+) on Buildings/Floors/Rooms** — `check-sync-status` counts all `Building/Building Storey/Space` rows including ACC/IFC-imported entities that don't exist in Asset+. Asset card already excludes them (`accLocalCount`); structure card doesn't.

3. **"62 461 objekt synkade" on the structure card is wrong** — comes from `syncState.total_assets`, which is a cumulative `totalSynced += synced` across every resumed upsert page, counting re-upserts of the same rows.

4. **Swedish strings still appear in sync UI** — e.g. "lokala", "i Asset+", "Ej synkad", "Synkar…", "Synka", "Senast", "objekt synkade". Should be English to match the rest of the app.

## Plan

### A. Stop background sync activity (manual-only)

1. **`src/components/layout/AppLayout.tsx`** — remove `<DataConsistencyBanner />` mount (line 140) and its import (line 8).
2. **`src/components/common/DataConsistencyBanner.tsx`** — remove the auto `checkDelta()` `useEffect`. Keep component code in case it's needed inside Settings later, but it no longer self-triggers.
3. **`src/components/layout/SyncProgressBanner.tsx`** — verify no auto-resume path (already commented). Only render when an active `running`/`interrupted` row exists in `asset_sync_state`.
4. **`src/hooks/useModelLoader.ts`** — gate any `asset-plus-sync` invocation behind an explicit user action / setting; do not call automatically when opening a building.

### B. Fix structure count parity

In `supabase/functions/asset-plus-sync/index.ts`, `check-sync-status` (~line 659):
- Add `accLocalStructureCount` mirroring the existing `accLocalCount` predicate used for assets (same ACC/IFC source filter).
- Return `structure.localCount` as Asset+-scope (total minus ACC), plus `structure.accLocalCount` for the badge text the UI already renders (line 3266).
- `inSync` then compares Asset+-scope local vs `remoteStructureCount`.

### C. Fix the "62 461 objekt synkade" label

1. **UI (`ApiSettingsModal.tsx`, line 3280)** — pass `totalSynced={syncCheck?.structure?.localCount}` for the Structure card, not `syncState.total_assets`. While `isRunning`, show "X upserts" (may include duplicates); when idle show the unique count.
2. **Edge function `sync-structure`** — at the start of a fresh (non-resumed) run, reset `progress.total_synced` to 0. On `completed`, write the actual unique structure row count (`SELECT count(*) WHERE category in (...)`) into `asset_sync_state.total_assets` so cards show the real number after sync.

### D. Translate sync UI to English

Sweep these files and replace Swedish copy with English equivalents:

- `src/components/settings/SyncProgressCard.tsx` — already mostly English; verify "local", "in Asset+", "In sync", "Out of sync", "Last:", "Never", "Syncing…", "Sync".
- `src/components/settings/ApiSettingsModal.tsx` — Sync tab: card titles already English; replace any Swedish toast/label such as "Synkar…", "Synka", "Ej synkad", "Senast", "objekt synkade", "lokala", "i Asset+", "Byggnader", "skapade", "Skapa ACC-synkade objekt…" tooltip, "Tvinga om-nedladdning…", "Återställ", etc.
- `src/components/layout/SyncProgressBanner.tsx` — already English; double-check toast messages.
- `src/components/common/DataConsistencyBanner.tsx` — already English; verify.
- `src/components/settings/SyncStatusLog.tsx` — translate any Swedish labels.
- Toasts in `asset-plus-service.ts` and any sync-related component (search `rg -n "Synk|synkad|lokala|Senast|Byggnader|Återställ|Tvinga"`) — replace with English.

Naming convention to use (consistent with existing English UI):
- "Synka" → "Sync"
- "Synkar…" → "Syncing…"
- "Ej synkad" → "Out of sync"
- "Synkad" → "In sync"
- "lokala" → "local"
- "i Asset+" → "in Asset+"
- "objekt synkade" → "objects synced"
- "Senast" → "Last"
- "Byggnader" → "Buildings", "plan/rum" → "floors/rooms"
- "Återställ" → "Reset", "Tvinga" → "Force"

### E. Verification

- Open the app → Network panel shows no `asset-plus-sync` calls until the user opens Settings → Sync and clicks a button.
- Settings → Sync → "Check Status": Buildings/Floors/Rooms shows ~3 379 local / 3 379 in Asset+ (with "(N ACC/IFC excluded)" subtitle), "In sync" badge.
- Run Structure sync manually → progress label reads "X upserts (may include duplicates)" while running; finished card reads the unique count, not 62k.
- All sync dialogs, cards, badges and toasts read in English only.

## Files to change

- `src/components/layout/AppLayout.tsx`
- `src/components/common/DataConsistencyBanner.tsx`
- `src/components/layout/SyncProgressBanner.tsx`
- `src/components/settings/ApiSettingsModal.tsx`
- `src/components/settings/SyncProgressCard.tsx`
- `src/components/settings/SyncStatusLog.tsx`
- `src/hooks/useModelLoader.ts`
- `src/services/asset-plus-service.ts` (toast strings if any)
- `supabase/functions/asset-plus-sync/index.ts`
