

# Fix XKT Model ID Resolution for Småviken

## Problem
The `GetXktData` endpoint requires a valid `modelid` parameter (UUID). Currently:
1. `GetAllRelatedModels` returns models with `modelId: null` for Småviken
2. The fallback tries `bimObjectId` as `modelid`, which returns 404
3. Name-based matching against `GetAllModelRevisions` picks wrong models from other buildings (same discipline names like "A-modell" exist across buildings)

## Root Cause
The `modelRevision` object from `GetAllModelRevisions` contains the correct `modelId`. But the current matching logic (line 1477-1483) uses fuzzy name matching (`revName.includes(modelNameLower)`), which is unreliable when multiple buildings have identically-named models.

## Solution

### 1. Fix revision matching in `asset-plus-sync/index.ts` (sync-xkt action)

**Replace the current name-based matching** with a two-step approach:
- **Step A**: Match revision to model by `bimObjectId` (exact match — the `BimModel` from `GetAllRelatedModels` has `bimObjectId`, and revisions also carry a `bimObjectId` or can be matched via the model's own `modelId`)
- **Step B**: If no `bimObjectId` match, filter revisions by `entityName` matching the building name first, THEN match by `modelName` — this scopes name matching to the correct building

### 2. Store `modelId` from revisions in the `assets` table attributes

During structure sync (when we upsert Building Storey objects), persist the `modelId` from the matched revision into the storey's `attributes` JSON. This makes the `modelId` available for XKT sync without re-querying `GetAllModelRevisions`.

### 3. Use stored `modelId` as primary identifier for GetXktData

In the XKT sync download logic, check the `assets` table for a stored `modelId` before falling back to the current identifier chain.

## Files to Edit

### `supabase/functions/asset-plus-sync/index.ts`

**Revision matching (lines ~1470-1496)**:
- Match revisions to models using `bimObjectId` first (exact)
- Filter by `entityName` (building name) before name matching
- Log matched `modelId` clearly

**XKT download (lines ~1540-1580)**:
- Add Strategy 0: look up `modelId` from `assets` table (Building Storey attributes) for the building
- Use this stored `modelId` as the primary `modelid` parameter in the `GetXktData` call

**Structure sync (upsert flow)**:
- When processing Model/Building Storey objects from Asset+, also query `GetAllModelRevisions` filtered to that building and store the `modelId` in attributes

### Estimated scope
~80 lines changed in `asset-plus-sync/index.ts`. No database migration needed (using existing `attributes` jsonb column).

