

# Fix Asset+ 3D endpoint discovery to use correct API paths

## Background
XKT sync fails because `discover3dModelsEndpoint` tries paths like `/threed/GetModels` which do not exist in the Asset+ API. According to the OpenAPI specification, the correct endpoints are:

1. **`/GetAllRelatedModels?fmguid={buildingFmGuid}`** — returns `BimModel[]` with `modelId`, `name`, `revisionId`, etc.
2. **`/GetXktData?modelid={modelId}&context=Building`** — returns XKT binary data for a specific model

The current code expects model objects with `xktFileUrl` fields, but Asset+ separates model listing from XKT download.

## Plan

### 1. Rewrite `discover3dModelsEndpoint` in `asset-plus-sync/index.ts`
Replace the 6 wrong candidate paths with the correct Asset+ endpoint:
- Try `{assetDbUrl}/GetAllRelatedModels?fmguid={buildingFmGuid}` (the API key goes in header or body, auth via Bearer token)
- Also try `{baseUrl}/asset/GetAllRelatedModels?fmguid={buildingFmGuid}` as fallback
- Response is a direct `BimModel[]` array
- Cache the working base path as before

### 2. Update model processing loop (lines ~1474-1590)
Currently expects `model.xktFileUrl` or `model.fileUrl`. Change to:
- Extract `modelId` from each `BimModel` object (`model.modelId`)
- Construct XKT download URL: `{assetDbUrl}/GetXktData?modelid={modelId}&context=Building`
- Fetch XKT binary from that URL with Bearer token auth
- Use `model.name` for `model_name` in the DB record

### 3. Update `sync-xkt-building` action (lines ~1662-1800)
Same changes as #2 — use `GetXktData` for downloading individual models after discovery.

### 4. Update endpoint cache key
Change from `getmodels_url` to `getallrelatedmodels_url` to avoid using stale cached wrong paths.

## Technical details

```text
Current (broken):
  GET {base}/threed/GetModels?fmGuid=X&apiKey=Y  →  404 / HTML

Fixed:
  Step 1: GET {assetDbUrl}/GetAllRelatedModels?fmguid=X
          Headers: Authorization: Bearer {token}
          Response: BimModel[] with { modelId, name, revisionId, ... }

  Step 2: GET {assetDbUrl}/GetXktData?modelid={modelId}&context=Building
          Headers: Authorization: Bearer {token}
          Response: XKT binary (application/octet-stream)
```

### Files changed
- `supabase/functions/asset-plus-sync/index.ts` — rewrite discovery + download logic

