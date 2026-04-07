

# Fix XKT sync: GetXktData needs bimobjectid parameter

## Problem
`GetXktData` returns 400 because the API requires **two** identifiers: `modelid` AND one of `bimobjectid`, `externalguid`, or `externalid`. We're only passing `modelid` + `context`.

The `BimModel` objects returned by `GetAllRelatedModels` contain `bimObjectId` — we just need to pass it through.

## Root cause (from OpenAPI spec)
```text
/GetXktData parameters:
  - modelid     (required)
  - bimobjectid (one of three must be set)  ← MISSING
  - externalguid
  - externalid
  - context     (required: Default|Asset|Space|Level|Building)
```

## Plan

### 1. Fix `sync-xkt-building` action (~line 1738)
Add `bimobjectid` from the model metadata to the `GetXktData` URL:
```
{base}/GetXktData?modelid={modelId}&bimobjectid={bimObjectId}&context=Building
```
The `bimObjectId` comes directly from each `BimModel` in the `GetAllRelatedModels` response.

### 2. Fix `sync-xkt` resumable action (~line 1511)
Same fix — when downloading via revisions, pass `bimobjectid`. For revisions, we may need to cross-reference back to the `GetAllRelatedModels` models to get `bimObjectId`, or use `fmguid` as `externalguid`.

### 3. Fix client-side bootstrap in `useModelLoader.ts` (~line 183-225)
Update the candidate paths to also try `GetAllRelatedModels` + `GetXktData` with `bimobjectid`, matching the server-side logic. This ensures the client fallback also works with the correct API.

### 4. Add revision-based update detection
In `sync-xkt-building`, after fetching models via `GetAllRelatedModels`, compare each model's `revisionId` against the stored `source_updated_at` in `xkt_models`. Only re-download if the revision has changed. This avoids re-downloading unchanged models and detects updates during sync.

## Files changed
- `supabase/functions/asset-plus-sync/index.ts` — add `bimobjectid` to GetXktData calls, add revision comparison
- `src/hooks/useModelLoader.ts` — update client bootstrap to use correct API paths

