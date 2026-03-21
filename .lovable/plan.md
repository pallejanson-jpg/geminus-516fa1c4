

## Plan: Reset Stuck ARK Job + Prevent Future Stuck Jobs

### Problem Analysis

**Current state for building SV (Smedvig)**:
- **Stuck job**: `c1f5e5fa` — ARK model, status `processing`, progress 20%, no heartbeat updates since creation (11:23 today)
- **XKT models exist**: Both ARK (from March 19) and RIV (from today) are in `xkt_models` and should load in the viewer
- **Viewer loads from `xkt_models`** — the stuck conversion job should NOT block model display

**Root cause of stuck jobs**:
1. `sendBeacon` on tab close doesn't include auth headers → Supabase rejects the update → job stays `processing` forever
2. Auto-reset only triggers when opening Settings panel, and only for the current user's jobs
3. `isStuckJob` in the UI requires 2 hours before showing the reset button — too long
4. No global/automatic mechanism catches orphaned jobs

### Implementation

**Step 1 — Reset the stuck job (database migration)**

SQL migration to reset the specific stuck job:
```sql
UPDATE conversion_jobs 
SET status = 'error', 
    error_message = 'Auto-reset: browser conversion crashed or tab was closed',
    updated_at = now()
WHERE id = 'c1f5e5fa-2ad8-4122-a3f6-e30aa610d0df' 
  AND status = 'processing';
```

**Step 2 — Fix `sendBeacon` (CreateBuildingPanel.tsx)**

The `sendBeacon` call on `beforeunload` sends raw JSON without auth headers, so Supabase ignores it. Fix by:
- Using the Supabase REST URL with the anon key as a query parameter
- Or switching to `navigator.sendBeacon` with proper PATCH method workaround
- Best approach: Use `supabase.from().update()` in the `beforeunload` handler (synchronous best-effort)

**Step 3 — Reduce stuck detection threshold (CreateBuildingPanel.tsx)**

- Change auto-reset threshold from 5 minutes to **3 minutes** (browser conversion heartbeats every 30s, so 3 min = 6 missed heartbeats)
- Change `isStuckJob` UI threshold from 2 hours to **10 minutes**

**Step 4 — Add global stuck-job cleanup on viewer mount (NativeXeokitViewer.tsx)**

Add a lightweight check at viewer initialization: if any `conversion_jobs` for the current building are stuck in `processing` with `updated_at` older than 5 minutes, reset them to `error`. This ensures the viewer page itself cleans up orphans without waiting for the user to visit Settings.

**Step 5 — Add viewer-side auto-reset for the current building**

In `NativeXeokitViewer.tsx`, after fetching models, also query `conversion_jobs` for the building and auto-reset any stuck ones. This is a "passive cleanup" that runs whenever anyone views the building.

### Files Modified

| File | Change |
|---|---|
| Migration SQL | Reset stuck job `c1f5e5fa` |
| `src/components/settings/CreateBuildingPanel.tsx` | Fix `sendBeacon` auth, reduce thresholds (5min→3min auto-reset, 2h→10min UI) |
| `src/components/viewer/NativeXeokitViewer.tsx` | Add passive stuck-job cleanup on mount for the current building |

### Technical Details

- **Font**: Inter (for reference from previous conversation)
- **Heartbeat interval**: 30 seconds (unchanged)
- **New auto-reset threshold**: 3 minutes without heartbeat update
- **New UI "stuck" indicator**: 10 minutes
- **Viewer cleanup**: runs once on mount, best-effort, non-blocking

