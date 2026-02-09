
# ACC 3D Geometry: Model Derivative API Translation and XKT Conversion

## Overview

Enable 3D viewing of ACC-sourced BIM models in Geminus by using Autodesk's Model Derivative API to translate RVT files, then converting the output to XKT format for the existing xeokit viewer.

## Architecture

The pipeline has 3 stages:

```text
RVT file (in ACC)
    |
    v
[1] Model Derivative API: POST translation job (RVT -> SVF2)
    |  (runs in edge function, async - takes 1-10 min)
    v
[2] Download SVF2 derivative manifest + geometry files
    |  (edge function fetches derivative files)
    v
[3] Convert to XKT and store in storage bucket
    |  (client-side JS using @xeokit/xeokit-convert)
    v
XKT file in xkt-models storage bucket
    -> loads in existing AssetPlusViewer via xeokit XKTLoaderPlugin
```

## Technical Details

### Stage 1: Trigger Translation (Edge Function)

**File: `supabase/functions/acc-sync/index.ts`** -- new action `translate-model`

- Accept a `versionUrn` (already available from the folder browser) and optional `derivativeUrn`
- Call Model Derivative API `POST /modelderivative/v2/designdata/job` with:
  - `input.urn`: base64-encoded version URN
  - `output.formats`: `[{ "type": "svf2", "views": ["3d"] }]`
- Return job status immediately (translation is async, takes minutes)

**New action `check-translation`**:
- Call `GET /modelderivative/v2/designdata/{urn}/manifest` to check progress
- Return status: `pending`, `inprogress`, `success`, `failed`
- When `success`: return the list of derivative files (geometry URNs)

### Stage 2: Download Derivative (Edge Function)

**New action `download-derivative`**:
- Use the manifest to identify the SVF2/OBJ derivative URN
- Call `GET /modelderivative/v2/designdata/{urn}/manifest` to get the derivative bubble
- For OBJ format (simpler): download the OBJ file directly via derivative download endpoint
- Upload the downloaded geometry file to Supabase Storage temporarily

**Important**: To avoid memory limits, download derivatives in chunks or use streaming. For very large models, consider OBJ output (single file) instead of SVF2 (multiple files).

### Stage 3: Client-Side XKT Conversion

**New dependency**: `@xeokit/xeokit-convert` (browser-compatible build)

- The npm package provides `parseGLTFIntoXKTModel` and `parseOBJIntoXKTModel` functions that work in the browser
- After the derivative is available as a download URL, the client:
  1. Fetches the geometry file (OBJ or glTF)
  2. Parses it into an `XKTModel` using the appropriate parser
  3. Calls `writeXKTModelToArrayBuffer()` to produce the XKT binary
  4. Stores the XKT via the existing `xktCacheService.saveModelFromViewer()` pipeline

### OAuth Scope Update

**File: `supabase/functions/acc-auth/index.ts`**:
- Update scope from `"data:read account:read"` to `"data:read data:write data:create account:read"` to allow triggering Model Derivative translation jobs

**File: `supabase/functions/acc-sync/index.ts`**:
- Update 2-legged token scope similarly

### UI: Translation Trigger in Folder Browser

**File: `src/components/settings/ApiSettingsModal.tsx`**:
- Add a "Konvertera 3D" button next to BIM files in the folder tree (alongside the existing "Synka BIM" button)
- Show translation progress with polling (pending -> in progress -> complete)
- When translation completes, trigger client-side XKT conversion automatically
- Show "3D-modell tillganglig" badge on successfully converted files

### Status Tracking

**New database column or table**: Track which ACC models have been translated/converted:
- Add fields to `xkt_models` or create a lightweight `acc_model_translations` table:
  - `version_urn`, `translation_status`, `derivative_urn`, `started_at`, `completed_at`
- This prevents re-translating models that are already converted

## Alternative Approach: OBJ Instead of SVF2

SVF2 is a complex multi-file format. OBJ is simpler (single geometry file + MTL material file). The Model Derivative API supports RVT -> OBJ translation. Using OBJ:
- Pros: Single file download, simpler conversion, less memory
- Cons: No material/texture fidelity, no metadata tree in geometry

**Recommendation**: Start with OBJ for simplicity. Upgrade to SVF2/glTF later if material fidelity is needed.

## Implementation Order

1. Update OAuth scopes (both 2-legged and 3-legged)
2. Add `translate-model` and `check-translation` actions to `acc-sync`
3. Add `download-derivative` action to `acc-sync`
4. Install `@xeokit/xeokit-convert` and build client-side conversion utility
5. Add "Konvertera 3D" UI button with progress polling
6. Wire up the full pipeline: translate -> download -> convert -> store -> view

## Files to Create/Modify

| File | Change |
|---|---|
| `supabase/functions/acc-auth/index.ts` | Update OAuth scope to include `data:write data:create` |
| `supabase/functions/acc-sync/index.ts` | Add `translate-model`, `check-translation`, `download-derivative` actions |
| `src/components/settings/ApiSettingsModal.tsx` | Add "Konvertera 3D" button, translation progress UI |
| `src/services/acc-xkt-converter.ts` | New: client-side OBJ/glTF -> XKT conversion using `@xeokit/xeokit-convert` |
| `package.json` | Add `@xeokit/xeokit-convert` dependency |

## Risks and Mitigations

- **Large derivatives may exceed edge function memory**: Download in streaming chunks, or use OBJ format which produces smaller single files
- **Translation time**: RVT -> SVF2/OBJ can take 1-10+ minutes. UI must show async progress with polling
- **OAuth scope change**: Users with existing 3-legged auth will need to re-authorize to get the new scopes
- **xeokit-convert browser compatibility**: The npm package is primarily Node.js-focused. Need to verify browser build works. Fallback: use a Web Worker for conversion
