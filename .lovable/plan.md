

## Problem Analysis

The IFC conversion job for building SV completed successfully — the XKT 3D model and metadata JSON were both uploaded. However, **no spatial hierarchy** (storeys, spaces) was saved to the `assets` table. Only the Building and Model entries exist.

### Root Cause

There are two parallel paths for hierarchy population, and both failed:

1. **Edge function path** (`ifc-extract-systems` with `enrich-guids` mode): Called non-blocking before conversion starts. Hits WORKER_LIMIT on the 39 MB file. The metadata-only fallback uses the *previous* conversion's metadata, which may not have had hierarchy data either.

2. **Browser conversion path**: `parseIFCIntoXKTModel` completed and generated a valid XKT, but `xktModel.metaObjects` didn't contain proper `IfcBuildingStorey`/`IfcSpace` type information (likely a web-ifc limitation with this IFC schema). The metadata JSON fallback (lines 561-581) also found nothing.

**Yet the uploaded metadata JSON does contain hierarchy data** — it just was never used to populate the database after the browser conversion succeeded.

## Plan

### 1. Add post-conversion hierarchy recovery from uploaded metadata

After the browser conversion succeeds (line 715, status set to `done`), if no levels/spaces were extracted during conversion, trigger a final attempt using the just-uploaded metadata JSON file.

**File**: `src/components/settings/CreateBuildingPanel.tsx`

- After line 695 (soft-delete block), before marking job as done:
  - If `result.levels.length === 0 && result.spaces.length === 0`, call `ifc-extract-systems` with `mode: 'metadata-only'` targeting the newly uploaded metadata file
  - This ensures the freshly uploaded `_metadata.json` is used as the hierarchy source

### 2. Fix `ifc-extract-systems` metadata-only mode to use the latest metadata file

**File**: `supabase/functions/ifc-extract-systems/index.ts`

- The `loadMetaObjectsFromLatestMetadata` function should sort by filename timestamp to pick the most recent `_metadata.json` file, not just any file
- Currently it may be picking up an older metadata file that lacks hierarchy

### 3. Add `globalId` extraction to the converter's metaObject output

**File**: `src/services/acc-xkt-converter.ts`

- When building `metaModelObjects` (line 215-220), also extract the IFC GlobalId from `metaObj.originalSystemId` or `metaObj.globalId` so the hierarchy population uses stable IFC GUIDs instead of deterministic hashes
- This improves re-import stability

### 4. Persist conversion logs to the job record

**File**: `src/components/settings/CreateBuildingPanel.tsx`

- The `addLog` function used inside `runBrowserConversion` doesn't write to `log_messages` in the database. Add periodic log persistence so debugging is possible after the fact.

### 5. Immediate fix: populate hierarchy now

- Run a migration or manual edge function call using the existing metadata JSON (`ifc-1773914696972_metadata.json`) to populate storeys and spaces for building SV right now.

## Technical Details

The key insight is that the browser-side `parseIFCIntoXKTModel` from `@xeokit/xeokit-convert` successfully creates geometry but may not populate `xktModel.metaObjects` with proper IFC type classification for all IFC schemas. The metadata JSON *is* generated correctly (it has metaObjects), but the type fields may use internal xeokit identifiers rather than standard IFC type names like `IfcBuildingStorey`.

The fix adds a reliable "last resort" path: after XKT + metadata are uploaded, if the in-memory extraction found zero hierarchy, re-parse the uploaded metadata JSON server-side using the existing `metadata-only` mode.

