

## Plan: Fix ACC Building Asset Sync + Viewer Back Button

### Problem 1: ACC buildings trigger unnecessary Asset+ sync

When opening "Assets" for the ACC-imported Stadshuset Nyköping (FMGUID: `acc-bim-building-...`), `AssetsView` finds zero "Instance" assets locally and calls `syncBuildingAssetsIfNeeded` which invokes the `asset-plus-sync` edge function. This is wrong — ACC buildings already have their own assets with `acc-bim-instance-*` GUIDs. The Asset+ sync won't find anything for an ACC building GUID, wasting time and showing confusing loading states.

**Root cause:** Neither `AssetsView.tsx` nor `asset-plus-service.ts` check if the building FMGUID is ACC-sourced before triggering Asset+ sync.

**Fix:** Add an `isAccBuilding()` helper that checks for `acc-bim-` and `acc-` prefixes. Skip the Asset+ sync trigger for ACC buildings — they already have assets from the BIM sync pipeline.

### Problem 2: Back button goes to `/` instead of previous page

**Fix:** Change `handleGoBack` from `navigate('/')` to `navigate(-1)` with fallback.

### Problem 3: Duplicate "Stadshuset Nyköping" 

The user has two entries — one from Asset+ (normal FMGUID `7cad5eda...`) and one from ACC BIM sync (`acc-bim-building-...`). The Asset+ one has no storeys/models and can be deleted. This is a data issue, not a code bug — but we should note it.

### Files to Change

**`src/services/asset-plus-service.ts`**
- Add `isAccSourcedBuilding(fmGuid: string)` helper checking for `acc-bim-` or `acc-` prefix
- In `syncBuildingAssetsIfNeeded` and `ensureBuildingAssets`: return early if the building is ACC-sourced

**`src/components/portfolio/AssetsView.tsx`**
- Import the helper and skip the Asset+ sync in `initAssets` for ACC-sourced buildings
- For ACC buildings, just fetch existing assets from DB without triggering sync

**`src/pages/UnifiedViewer.tsx`**  
- Line 427: Change `navigate('/')` to `navigate(-1)` with history length fallback

