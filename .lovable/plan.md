## Problem

The Asset+ URL you shared:

```
revisionStatus=4
revisionId=c336d675-e4ed-4bee-a09e-11e4ccc97541
modelType=0
buildingBimObjectId=46359aa0-…
complexBimObjectId=c3d4a4a8-…
```

`revisionStatus=4` = **Published**. The Asset+ UI always opens the latest *Published* revision.

In our codebase, the revision matching uses `.find()` on the full `GetAllModelRevisions` list with no status filter and no date sort:

- `supabase/functions/asset-plus-sync/index.ts` lines 1544–1564 (sync — primary path)
- `supabase/functions/asset-plus-sync/index.ts` lines 2026–2030 + 1986–1990 (sync — secondary path / `revisionMap`)
- `src/hooks/useModelLoader.ts` lines 253–263 (client bootstrap)

`GetAllModelRevisions` returns *every* revision (Draft, Published, Archived, …) for each model. `.find()` returns the first match, so we can pick a Draft or an old revision and download/cache that XKT — which is why the wrong A‑modell version is loaded for Småviken.

The diagnostic code at line 3054–3056 already proves the right pattern:

```ts
const aModelRevs = filtered.filter(r => r.modelName === 'A-modell');
const publishedRevs = aModelRevs.filter(r => r.status === 4);
const latestPublished = publishedRevs
  .sort((a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime())[0];
```

…but the real sync/loader paths don't apply it.

## Plan

### 1. Centralize "pick latest Published revision" helper

Add a small pure helper used by all three call sites:

```ts
// Pick the newest revision with status === 4 (Published) for a candidate set.
// Falls back to newest of any status if no Published exists.
function pickLatestPublishedRevision(revs: any[]): any | null {
  if (!revs?.length) return null;
  const byDate = (a: any, b: any) =>
    new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime();
  const published = revs.filter(r => Number(r.status) === 4);
  return (published.length ? published : revs).sort(byDate)[0] ?? null;
}
```

Place it in the edge function (top of `asset-plus-sync/index.ts`) and a mirrored copy in `src/hooks/useModelLoader.ts` (or extract to `src/services/asset-plus-service.ts` and import from both client paths — edge function keeps its own copy because it can't import client modules).

### 2. Replace the three matching blocks

For each existing match-by-bimObjectId / match-by-modelId / match-by-name step, **collect candidates** instead of returning the first match, then run them through `pickLatestPublishedRevision`. Skeleton:

```ts
let candidates: any[] = [];
if (bimObjId) {
  candidates = allRevisions.filter(r => String(r.bimObjectId || r.BimObjectId || '') === bimObjId);
}
if (!candidates.length && rawModelId) {
  candidates = allRevisions.filter(r => String(r.modelId || '') === String(rawModelId));
}
if (!candidates.length && modelNameLower) {
  candidates = allRevisions.filter(r => {
    const sameBuilding = String(r.entityName || '').toLowerCase() === buildingNameLower;
    const revName = String(r.modelName || '').toLowerCase();
    return sameBuilding && revName &&
      (revName === modelNameLower || revName.includes(modelNameLower) || modelNameLower.includes(revName));
  });
}
const matchedRev = pickLatestPublishedRevision(candidates);
```

Apply at:
- `asset-plus-sync/index.ts` ~1544–1564 (primary sync mapping)
- `asset-plus-sync/index.ts` ~1986–2030: replace `revisionMap` build + inline `.find()` with a `Map<modelId, latestPublishedRev>` built via `pickLatestPublishedRevision` grouped by `modelId`.
- `useModelLoader.ts` ~253–263 (client bootstrap)

### 3. Re-download when the cached revision is stale

`xkt_models.source_updated_at` already stores `revisionId`. Today the check is `storedRevision === revisionId` and skips when equal, which is correct **once the right revisionId is selected**. After fix (1)+(2), an old cached XKT (saved against a Draft revision) will simply mismatch the new latest-Published `revisionId` and trigger re-download — no extra logic needed.

For client `useModelLoader.ts`, `xktCacheService.saveModelFromViewer(..., revisionId)` is already revision-tagged; just ensure the loader checks `revisionId` before serving from cache. Verify `xkt-cache-service.ts` honours revision when reading; if it doesn't, add the comparison and invalidate on mismatch.

### 4. Logging

Bump the existing `console.log` at line 1571 to also print `revisionId`, `status`, `dateCreated` so the next regression is one log line away:

```
✓ A-modell: matched revision modelId=… revisionId=c336d675… status=4 dateCreated=2025-…
```

### 5. Verify

1. Trigger a manual Asset Sync from Settings for Småviken.
2. Check edge function logs: every matched revision line should show `status=4` and the revisionId from the URL above (`c336d675-e4ed-4bee-a09e-11e4ccc97541`) for A-modell.
3. Open Småviken in the viewer → A‑modell geometry matches what Asset+ shows at the supplied URL.
4. Confirm no `asset-plus-sync` calls happen on app load (manual-only sync from earlier change still in effect).

## Files to change

- `supabase/functions/asset-plus-sync/index.ts` (primary + secondary sync paths, helper, logging)
- `src/hooks/useModelLoader.ts` (client bootstrap helper + matcher)
- `src/services/xkt-cache-service.ts` (verify revision-aware cache hit; small change only if missing)
