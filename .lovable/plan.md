
Goal: make the Settings XKT sync actually update Småviken/current viewer building and stop reporting false success when nothing was refreshed.

What I verified
- The backend did run an XKT sync at 17:29, but it finished as `completed` with `total_assets = 0`.
- For Småviken (`a8fe5835-e293-4ba3-92c6-c7e36f675f23`), logs show `Found 4 models from GetAllRelatedModels`, then every `GetXktData` request returned `404`.
- The database rows in `xkt_models` for Småviken are still old (`updated_at` 2026-03-06), so no fresh XKT was uploaded.
- The force-refresh UI currently uses `favoriteBuildings[0]`, not the building currently open in the viewer, so it is not guaranteed to refresh the building the user is looking at.

Implementation plan
1. Bind force refresh to the active viewer building
- In `ApiSettingsModal.tsx`, stop defaulting to `favoriteBuildings[0]`.
- Use the active viewer building/context first (`viewer3dFmGuid` or selected facility), with favorites only as fallback.
- Show the exact building being refreshed in the UI so the target is explicit.

2. Fix the XKT download identifier logic
- In `supabase/functions/asset-plus-sync/index.ts`, extract the XKT fetch logic into one shared helper for `sync-xkt-building` and `sync-xkt-resumable`.
- Do not rely on one identifier combination.
- Try `GetXktData` with a fallback chain based on available metadata:
  - `bimobjectid = model.bimObjectId`
  - `externalguid = model.externalGuid`
  - `bimobjectid = building asset attributes.parentBimObjectId / buildingBimObjectId`
  - `externalguid = model.fmGuid`
  - `externalguid = buildingFmGuid` only as last fallback
- In the resumable path, stop name-matching revisions across all revisions. Instead:
  - start from `GetAllRelatedModels` for the current building
  - map revision info by `modelId`
  - sync only the model IDs actually returned for that building

3. Make sync status honest
- If all downloads return 404 or no file is written, mark the sync as failed/partial instead of `completed`.
- Return per-model error details in the response/status log.
- Do not present “force refresh complete” when `synced = 0`.

4. Only reload the viewer after a real refresh
- In `ApiSettingsModal.tsx`, only clear caches and dispatch `XKT_FORCE_RELOAD` when at least one model was actually re-downloaded and stored.
- If no model was refreshed, show a clear error toast explaining that the backend download failed, instead of reloading stale files.

5. Keep the freshness pipeline once downloads work
- Keep the existing no-cache upload behavior and viewer remount logic.
- After a successful overwrite, continue clearing `useXktPreload` memory/preload state so the viewer fetches fresh signed URLs immediately.

Files to update
- `supabase/functions/asset-plus-sync/index.ts`
- `src/components/settings/ApiSettingsModal.tsx`
- `src/hooks/useXktPreload.ts` only if a helper/API adjustment is needed
- `src/components/viewer/NativeViewerShell.tsx` only if reload signaling needs a small guard

Technical notes
- This is a real backend sync failure, not only a viewer cache problem.
- The API docs show `GetXktData` requires `modelid` plus one of `bimobjectid`, `externalguid`, or `externalid`.
- Current Småviken sync attempts are reaching `GetXktData` and getting `404`, which is why the viewer keeps showing the old stored XKT.
- Småviken’s building asset already has a `parentBimObjectId` in the database, and that identifier is not currently part of the fallback chain used by the sync.
- No database schema changes are needed.
