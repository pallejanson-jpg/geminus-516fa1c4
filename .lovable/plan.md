
Goal: make Småviken / the small vehicle building load the newest XKT from Asset+, not the old backend copy.

What I found
- The manual/global XKT sync UI uses `sync-xkt-resumable`, not the single-building path.
- The earlier freshness fix was applied in the single-building branch, but the resumable branch in `supabase/functions/asset-plus-sync/index.ts` still has the old skip behavior. That means a model can still be treated as “unchanged” when revision metadata is missing.
- The viewer does not re-check Asset+ if `xkt_models` already has files; it just signs and loads the cached storage files.
- Even after a backend refresh, stale XKT can still be shown because the app also keeps per-building XKT data in memory/preload caches.

Plan
1. Fix the remaining stale-skip logic
- Update the `sync-xkt-resumable` branch so it only skips when both revision values exist and match.
- Keep `force: true` as a hard override that always re-downloads and overwrites the XKT.

2. Add a real building-specific force refresh
- Add a “Force refresh 3D models” action for the selected building in settings.
- Make it call `asset-plus-sync` with:
  - `action: 'sync-xkt-building'`
  - `buildingFmGuid`
  - `force: true`
- This gives a deterministic refresh for Småviken instead of relying on the global resumable sync.

3. Clear stale local caches before reloading the viewer
- Extend the XKT cache/preload layer to fully reset one building:
  - clear in-memory XKT blobs
  - remove the building from the preload guard
  - stop reusing stale signed-url/memory paths
- After successful force sync, trigger a viewer remount/reload for the active building so it fetches the fresh backend files immediately.

4. Harden overwrite freshness
- Set low/no-cache behavior on XKT uploads in the sync/save paths so overwritten files are not served stale.
- Keep the same storage keys, but ensure the overwrite path is followed by cache invalidation + viewer reload.

Files to update
- `supabase/functions/asset-plus-sync/index.ts`
- `src/components/settings/ApiSettingsModal.tsx` and/or `src/components/settings/CreateBuildingPanel.tsx`
- `src/services/xkt-cache-service.ts`
- `src/hooks/useXktPreload.ts`
- `src/components/viewer/NativeViewerShell.tsx` or `src/components/viewer/NativeXeokitViewer.tsx`

Technical details
- The current viewer is still loading signed storage XKT files for Småviken, so this is a freshness pipeline issue, not a rendering issue.
- No database schema changes are needed.
- The implementation will make the forced path do 3 things in order: overwrite backend XKT, clear frontend building caches, then reload the viewer so native colors and newly added objects prove the model is actually updated.
