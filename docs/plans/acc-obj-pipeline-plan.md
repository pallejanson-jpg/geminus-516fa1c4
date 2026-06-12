# ACC Geometry Pipeline — OBJ/GLB Per-Storey Chunking

## Status: PLANNING (saved for reference)

## Background

This document captures the original ACC OBJ pipeline proposal and the Lovable-adapted implementation plan using GLB chunks instead of OBJ.

### Known Issues with OBJ Export
- **OBJ stalls at 99%** for large Revit models in APS Model Derivative
- **SVF2 returns 406** for some design types
- Current production code uses **SVF-only** (see `acc-sync/index.ts` line 2008)

---

## Original Proposal (OBJ-based)

### Syfte
Skapa ett flöde som:
1. Tar en ACC‑RVT version‑URN → beställer SVF2+OBJ i APS Model Derivative
2. Laddar ner derivatives
3. Läser SVF2‑metadata → mappar element till våningsplan (Level) och externalId (Revit)
4. Skriver OBJ per våningsplan (+MTL) + manifest.json + geometry_index.json
5. Publicerar till CDN
6. Viewer läser manifest och laddar aktivt plan först

### Manifest Schema (Original)
```json
{
  "modelId": "<modelKey>",
  "source": { "accProjectId": "", "accFileUrn": "", "apsRegion": "EU" },
  "version": "<versionStamp>",
  "format": "obj",
  "coordinateSystem": { "up": "Z", "units": "mm" },
  "materialPolicy": { "textures": false },
  "chunks": [{
    "storeyGuid": "...",
    "storeyName": "...",
    "priority": 1,
    "url": "...",
    "mtlUrl": "...",
    "bbox": [minX, minY, minZ, maxX, maxY, maxZ],
    "elementCount": 12345
  }],
  "fallback": { "objUrl": "...", "mtlUrl": "..." }
}
```

### Geometry Index Schema
```json
{
  "modelId": "<modelKey>",
  "version": "<versionStamp>",
  "mapping": [
    {
      "externalId": "<Revit UniqueId>",
      "storeyGuid": "...",
      "objGroup": "g_12345",
      "fm_guid": null
    }
  ]
}
```

---

## Adapted Plan (GLB-based)

### Why GLB Instead of OBJ
| Factor | OBJ | GLB |
|---|---|---|
| APS stall risk | Known hang at 99% for large models | N/A — derived from SVF |
| xeokit support | OBJLoaderPlugin (basic) | GLTFLoaderPlugin (mature) |
| File size | Large text format | Binary, compact |
| Materials | MTL separate file | Embedded |
| Existing code | None | `bim-to-gltf` function exists |

### Architecture Mapping
| Original Spec | Lovable Implementation |
|---|---|
| `packages/extractor` CLI | Edge function `acc-geometry-extract` |
| `apps/api` Express | Actions in edge function |
| `CDN_BASE` filesystem | Supabase Storage (`xkt-models` bucket) |
| `packages/viewer` React app | Enhanced `NativeXeokitViewer` |
| `packages/common` types | `src/lib/types.ts` |
| Jest tests | Vitest |

### Implementation Phases

#### Phase 1: Edge Function `acc-geometry-extract`
- Downloads SVF derivatives from APS
- Parses SVF metadata for Level grouping (keys: "Level", "Plan", "Våning", "Base Level", "Etage", "Niveau")
- Extracts per-storey geometry → GLB chunks
- Stores chunks + manifest in `xkt-models` bucket
- Stores geometry_index.json alongside

#### Phase 2: Viewer Integration
- `NativeXeokitViewer` checks for `_manifest.json` in storage
- If found, uses `GLTFLoaderPlugin` with priority-based chunk loading
- Priority: active floor (0) → adjacent (1) → rest (2)
- Falls back to existing XKT loading if no manifest

#### Phase 3: OBJ as Optional Secondary Format
- For small models or Geminus Base consumers only
- Not primary pipeline due to stall risk

### Database
The `xkt_models` table already has a `format` column (default `'xkt'`).
Values: `'xkt'` | `'glb'` | `'obj'`

---

## API Cookbook

### 1. Get APS Access Token
```bash
curl -s https://developer.api.autodesk.com/authentication/v2/token \
  -d "client_id=$APS_CLIENT_ID" \
  -d "client_secret=$APS_CLIENT_SECRET" \
  -d "grant_type=client_credentials" \
  -d "scope=data:read viewables:read"
```

### 2. Request Model Derivative Job (SVF only — avoid OBJ)
```bash
curl -s -X POST \
  https://developer.api.autodesk.com/modelderivative/v2/designdata/job \
  -H "Authorization: Bearer $APS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "input": { "urn": "<BASE64_ACC_VERSION_URN>" },
    "output": { "formats": [{ "type": "svf", "views": ["3d"] }] }
  }'
```

### 3. Poll Job Status
```bash
curl -s \
  "https://developer.api.autodesk.com/modelderivative/v2/designdata/<URN>/manifest" \
  -H "Authorization: Bearer $APS_TOKEN"
```

### 4. Download Derivatives
Navigate the bubble manifest to find SVF resources and property database.

---

## Extractor Logic

1. Read SVF properties → Build maps:
   - `dbId → externalId` (Revit UniqueId)
   - `dbId → levelName` (keys: "Level", "Plan", "Våning")
2. Group elements per Level
3. Extract geometry per storey → GLB chunk
4. Compute bbox per chunk
5. Write manifest + geometry_index
6. Write fallback monolithic file

---

## Credits Optimization
- **Idempotency**: Skip if manifest already exists for same version URN
- **Exponential backoff**: 10s → 20s → 30s when polling MD status
- **Cache SVF metadata**: Reuse when re-chunking
- **No textures**: `textures=false` in materialPolicy
- **CDN headers**: `Cache-Control: max-age=31536000, immutable`

---

## Known Gotchas
- **CORS**: APS derivative downloads may need proxy
- **Units**: SVF uses feet internally, convert to mm
- **Z-up**: SVF coordinate system is Z-up
- **EU region**: EMEA URNs (`wipemea`) require EU-specific endpoints
- **403 errors**: Model Derivative API must be enabled in Autodesk Developer Portal
- **Large models**: OBJ export hangs — use SVF → GLB instead
