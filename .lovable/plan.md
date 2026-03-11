

# Plan: ACC GLB Geometry Pipeline — Real Geometry Extraction

## Problem

The current `acc-geometry-extract` function creates **placeholder cube GLBs** instead of real geometry. The logs show:
- SVF binary can't be parsed in Deno (no `forge-convert-utils`)
- IFC translation request returns 403 (missing `data:write` scope)
- `download-derivative` only finds SVF derivatives, no downloadable single-file geometry

## Solution: Two-Phase Approach

### Phase 1: Request glTF translation from APS

Update `acc-sync`'s `translate-model` action to request **both SVF and glTF** output formats from APS Model Derivative. This gives us a downloadable GLB derivative.

**File:** `supabase/functions/acc-sync/index.ts`
- In the `translate-model` action, add `{"type":"svf","views":["3d"]}` AND `{"type":"svf","views":["3d"],"advanced":{"conversionMethod":"v3","buildingStoreys":"show"}}` — the SVF translation already works, and we keep it for metadata
- Add a **separate** translation request for glTF/GLB format: `{"type":"ifc"}` or keep current flow but fix token scopes

Actually, the simpler fix: update `acc-geometry-extract` to use the **3-legged token** (from `acc_oauth_tokens` table) instead of 2-legged, which has more privileges including `data:write`.

### Phase 2: Fix `acc-geometry-extract` to download real geometry

**File:** `supabase/functions/acc-geometry-extract/index.ts`

Changes:
1. **Add 3-legged token support** — Query `acc_oauth_tokens` for user tokens (same pattern as `acc-sync`), fall back to 2-legged
2. **Request glTF translation** if no GLB derivative exists — POST to Model Derivative API with `{"type":"obj","advanced":{"exportFileStructure":"single"}}` using proper token
3. **Poll and download** the resulting geometry file (GLB/OBJ)
4. **Store monolithic GLB** as the fallback in storage
5. **Create manifest with real storey metadata** — the Level grouping from SVF properties is already working, keep manifest pointing to monolithic GLB with storey metadata for visibility-based floor switching
6. **Remove placeholder cube creation** — replace with real geometry download

### Phase 3: Viewer uses manifest for visibility-based floor switching

**File:** `src/components/viewer/NativeXeokitViewer.tsx`

The viewer already handles manifest loading. Update:
1. When manifest has a `fallback` URL but no real per-storey chunks, load the monolithic GLB
2. Use the geometry index to map objects to storeys for visibility switching
3. Integrate with `useFloorPriorityLoading` for show/hide by storey

## Technical Details

### Token resolution in `acc-geometry-extract`
```text
1. Check acc_oauth_tokens for user's 3-legged token
2. If expired, refresh using client_id/client_secret
3. Fall back to 2-legged if no user token available
```

### Geometry download strategy
```text
1. Check bubble for existing glTF/GLB/OBJ derivatives
2. If found → download directly
3. If not → request new OBJ translation (single file)
4. Poll with exponential backoff (10s → 20s → 30s, max 10 attempts)
5. Download when ready
6. If OBJ → convert to GLB using existing buildGlb()
7. Store in xkt-models bucket
```

### Manifest structure (unchanged schema, real data)
```text
- chunks[]: storey metadata with element counts + bbox (from SVF properties)
- fallback.url: path to monolithic GLB in storage
- Viewer loads fallback GLB, uses chunk metadata for floor visibility
```

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/acc-geometry-extract/index.ts` | Add 3-legged token, real geometry download, remove placeholder cubes |
| `supabase/functions/acc-sync/index.ts` | Pass `userId` to geometry extract trigger so it can use 3-legged token |
| `src/components/viewer/NativeXeokitViewer.tsx` | Handle monolithic fallback GLB + storey visibility from manifest |
| `supabase/functions