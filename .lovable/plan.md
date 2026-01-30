
## Goal
Fix three recurring problem areas “once and for all”:

1) XKT sync: reliably discover the correct 3D endpoints, download XKT models, store them, and keep `xkt_models` populated.
2) Asset sync (ObjectType 4 / “Instance”): reliably complete sync to match remote counts and never get stuck in “running”.
3) Viewer cutting:
   - 2D: clipping slider must actually cut geometry at the chosen height.
   - 3D: “between storeys” cut must work consistently when isolating one floor.

---

## What I found (root causes)

### A) XKT sync currently can’t find the right 3D API endpoint
We tested the current “primary” models URL via `asset-plus-query -> test3DApi` and got a **404**:

- `.../api/threed/GetModels?fmGuid=...&apiKey=...` → 404

That means the current URL normalization strategy is wrong for this environment. As a result, `sync-xkt` / `sync-xkt-building` often “complete” with **0 models**, because they never discover a working GetModels endpoint.

### B) Asset sync is incomplete and the sync status is stale
`check-sync-status` shows:
- Structure is in sync.
- Instances are not: `localCount=43355`, `remoteCount=82541`.
- `asset_sync_state.assets` is stuck at `sync_status=running` since 2026-01-28.

This indicates the sync run likely timed out or crashed without updating state, leaving the UI and backend in a “stuck running” state.

### C) 3D storey cutting is currently using the wrong SectionPlane direction
xeokit SectionPlane docs say:
- “Discards elements from the half-space in the direction of `dir`”.

To remove geometry ABOVE a horizontal plane, `dir` must point UP: `[0, 1, 0]`.

Right now, ceiling clipping uses `[0, -1, 0]` (down), which discards BELOW the plane — the opposite of what we need for “cut off above-floor geometry”.

### D) 2D clipping slider + floor selection is not consistently wired
In 2D mode, the toolbar relies on `FLOOR_SELECTION_CHANGED_EVENT` to know which floor is “active” for clipping.
But `FloorVisibilitySelector` only dispatches this event in some flows (eg “show only floor” / “show all”), not in every “toggle floors until one remains” flow.

That makes 2D clipping appear broken in common usage patterns.

---

## Implementation plan

### 1) Fix xeokit clipping properly (2D slider + 3D between-storeys cut)

#### 1.1 Correct the SectionPlane direction semantics
**File**
- `src/hooks/useSectionPlaneClipping.ts`

**Changes**
- Change the 3D “ceiling” clipping direction to `[0, 1, 0]` (discard above).
- Keep 2D “floor plan” top cut direction as `[0, 1, 0]`.

This should immediately fix “3D cutting between storeys” for the common case.

#### 1.2 Support true 2D “slice” (optional but recommended)
If you want the 2D plan view to not show anything below the chosen floor:
- Add a second plane (bottom plane) just below the floor minY (or slightly above it) with direction `[0, -1, 0]` to discard below.
- This creates a “slab slice”: keep only geometry between bottom and top planes.

**File**
- `src/hooks/useSectionPlaneClipping.ts`

**Approach**
- Maintain two refs: `topPlaneRef`, `bottomPlaneRef` instead of a single `sectionPlaneRef`.
- Provide explicit APIs:
  - `apply2DClipping(floorId | globalBaseY, height)`
  - `apply3DCeilingClipping(floorId)`
  - `remove2DClipping()`
  - `remove3DClipping()`
- Avoid global “destroy all planes with prefix floor-clip-*” because that can accidentally remove the other mode’s plane(s).

#### 1.3 Ensure floor selection event is dispatched consistently
**File**
- `src/components/viewer/FloorVisibilitySelector.tsx`

**Changes**
- Whenever the visible floor set changes:
  - If exactly 1 floor is visible: dispatch `FLOOR_SELECTION_CHANGED_EVENT` with that floor id + bounds.
  - Otherwise dispatch with `floorId: null`.
- This will make 2D mode + slider deterministic regardless of how the user arrived at “one floor visible”.

#### 1.4 Make 3D storey clipping “just work” in solo floor mode
**File**
- `src/components/viewer/FloorVisibilitySelector.tsx`

**Changes**
- When visible floors becomes size=1, automatically enable clipping (unless user explicitly turned it off).
- Preserve the scissors toggle as a manual override, but default to ON in solo mode to solve the recurring “walls from above are still visible” problem.

#### 1.5 Ensure the 2D slider updates the correct plane(s) live
**Files**
- `src/components/viewer/ViewerToolbar.tsx`
- `src/components/viewer/VisualizationToolbar.tsx`
- `src/hooks/useSectionPlaneClipping.ts`

**Changes**
- Keep the slider dispatch (`CLIP_HEIGHT_CHANGED_EVENT`) as is, but update the handler so it:
  - Updates the active 2D clipping planes if in 2D mode.
  - Does not interfere with 3D solo clipping plane(s).
- Make sure switching 2D → 3D removes only 2D planes, and switching 3D → 2D sets up 2D planes for the currently active floor selection.

---

### 2) Fix XKT sync “once for all” (endpoint discovery + robust download + resumable)

#### 2.1 Implement robust GetModels endpoint discovery
**Files**
- `supabase/functions/asset-plus-sync/index.ts`
- `supabase/functions/asset-plus-query/index.ts` (so UI can “Test 3D API” reliably)

**Changes**
- Add a shared internal helper used by both functions:
  - `discover3dModelsEndpoint({ apiUrl, apiKey, accessToken, buildingFmGuid })`
- It will try a list of candidate URL shapes, because environments differ:
  - Use both:
    - `apiUrl` as-is (often ends with `/api/v1/AssetDB`)
    - a stripped “baseUrl”
  - Try paths like:
    - `/api/threed/GetModels`
    - `/threed/GetModels`
    - `/api/v1/AssetDB/api/threed/GetModels`
    - `/api/v1/AssetDB/threed/GetModels`
  - Try both API key styles:
    - `?apiKey=...`
    - header `x-api-key: ...`
  - Try both parameter names if needed:
    - `fmGuid=...`
    - `buildingFmGuid=...`

**Success criteria**
- First endpoint that returns `200` and parses as an array is selected.
- Return the resolved working URL for logging + reuse.

#### 2.2 Cache the resolved 3D endpoint (so we don’t probe constantly)
**Backend change (Lovable Cloud database migration)**
- Create a small table like `asset_plus_endpoint_cache`:
  - `key text primary key` (eg `getmodels_url`)
  - `value text`
  - `updated_at timestamptz`
- Cache TTL (eg 24h). If cache is fresh, use it directly.

This dramatically reduces repeated “try 5 URLs” overhead and makes the system stable.

#### 2.3 Make XKT download robust
**File**
- `supabase/functions/asset-plus-sync/index.ts`

**Changes**
- When processing models:
  - Accept multiple possible model response shapes:
    - `xktFileUrl`, `xkt_file_url`, `fileUrl`, etc.
  - If the returned URL is relative, resolve it against the API origin.
  - Fetch with timeouts (AbortSignal) and retries.
  - Validate file size:
    - skip 0 bytes
    - optionally skip “suspiciously tiny” sizes (< 1KB) to avoid corrupt cache
- Store in storage bucket + upsert into `xkt_models` as today.

#### 2.4 Make XKT sync resumable and “one click completes”
**Files**
- `supabase/functions/asset-plus-sync/index.ts`
- `src/components/settings/ApiSettingsModal.tsx`

**Changes**
- Add a resumable action, eg:
  - `action: "sync-xkt-resumable"`
  - It processes for max ~25–40 seconds, updates state frequently, and returns `{ interrupted: true, next: {...} }` when time budget is reached.
- Update API Settings button behavior:
  - Instead of fire-and-forget once, the UI will keep calling the resumable endpoint until it returns `interrupted: false`.
  - Show progress in UI using:
    - localCount/remoteCount (for assets)
    - `xkt_models` row count (for XKT)

This removes the “I’m prompted too many times” loop: the system will finish the sync in one user action.

---

### 3) Fix Asset sync (ObjectType 4 instances) and prevent “stuck running” forever

#### 3.1 Automatically mark stale “running” sync as interrupted
**File**
- `supabase/functions/asset-plus-sync/index.ts`

**Changes**
- In `check-sync-status`:
  - if a subtree is `running` but `updated_at` is older than (say) 10 minutes:
    - update it to `interrupted`
    - set `error_message` to something actionable (eg “Previous run timed out, click Resume”)

This ensures the UI never lies indefinitely.

#### 3.2 Implement resumable instance sync by building + skip cursor
**Backend change (migration)**
- Add a new table `asset_sync_progress`:
  - `job text primary key` (eg `assets_instances`)
  - `building_fm_guid text`
  - `skip integer`
  - `updated_at timestamptz`

**File**
- `supabase/functions/asset-plus-sync/index.ts`

**Changes**
- New action: `sync-assets-resumable`
  - Loads progress cursor.
  - Processes a time-budgeted number of pages:
    - fetch 500 rows at a time
    - upsert
    - update cursor after each page
    - update `asset_sync_state` after each page (heartbeat)
  - Moves to next building when current building completes.
  - Clears progress when finished and marks `asset_sync_state.assets = completed`.

This makes sync reliable under strict runtime limits.

#### 3.3 Update API Settings UI to “complete in one click”
**File**
- `src/components/settings/ApiSettingsModal.tsx`

**Changes**
- Replace the current fire-and-forget `sync-assets-chunked` call with a loop:
  - call `sync-assets-resumable`
  - if interrupted → call again after a short delay
  - stop when completed
- Keep the existing status polling, but now it will converge to completion.

---

## Files that will be changed

### Frontend
- `src/hooks/useSectionPlaneClipping.ts`
- `src/components/viewer/FloorVisibilitySelector.tsx`
- `src/components/viewer/ViewerToolbar.tsx`
- `src/components/viewer/VisualizationToolbar.tsx`
- `src/components/settings/ApiSettingsModal.tsx`

### Backend functions
- `supabase/functions/asset-plus-sync/index.ts`
- `supabase/functions/asset-plus-query/index.ts`

### Database (migration)
- New table: `asset_plus_endpoint_cache`
- New table: `asset_sync_progress`
(Optionally, we can unify both into one generic `sync_progress` table; I’ll keep them minimal and explicit unless you prefer generic.)

---

## How we’ll verify (end-to-end)

### XKT
1. Run “Test 3D API” in API Settings:
   - It should return 200 and a valid array from some resolved endpoint (not 404).
2. Run “Sync XKT” once:
   - The UI should keep working until `xkt_models` count > 0 (if models exist in the source system).
3. Open a building in the viewer:
   - On-demand cache check should now find models and stop prompting.

### Assets (instances)
1. Run “Check sync status”:
   - Instances should converge to `localCount === remoteCount`.
2. Verify per-building instance counts increase for the missing buildings.

### Clipping
1. In 3D, isolate a floor:
   - Above-storey geometry must be cut off correctly.
2. Switch to 2D mode:
   - Move the clipping slider:
     - geometry is cut at the chosen height in real time
   - Toggle floors until one remains:
     - clipping still works because floor selection event is consistent.

---

## Notes / constraints
- If the external system truly has no XKT models configured, sync will still result in 0 models; but after endpoint discovery fixes, we’ll be able to prove that with a successful GetModels response (200) returning an empty array (instead of 404).
- Runtime limits require resumable sync + UI orchestration; that’s the “once for all” mechanism in practice.

