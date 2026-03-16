

# Diagnosis: IFC Upload — Missing Hierarchy & 3D

## What Happened

### Building 01 (`e409df6f`) — ARK.ifc
- **XKT conversion**: Succeeded via browser. XKT model `ifc-1773648154703` uploaded to storage and `xkt_models` table at 08:02.
- **Hierarchy extraction via `ifc-extract-systems`**: Failed with `WORKER_LIMIT` (error 546). The edge function ran out of compute resources trying to parse the IFC with WASM.
- **Browser-side hierarchy**: The `runBrowserConversion` code at lines 506-520 should have extracted levels/spaces from `convertToXktWithMetadata`, but the `assets` table shows **0 storeys, 0 spaces** — only Building + Model categories.
- **Conversion job status**: Still `pending` (never updated). Wait — the XKT was uploaded at 08:02, meaning `runBrowserConversion` did run. But the job created at 07:58 is still `pending`, while there's also a NEW XKT from 08:02. This suggests the browser conversion ran successfully but the hierarchy extraction returned empty `levels`/`spaces` arrays from `convertToXktWithMetadata`.

### Jönköping Science Tower (`5ba7e540`) — A-40-V-100.ifc
- Job also `pending` with empty log_messages — conversion hasn't started or browser conversion failed silently.

## Root Causes

1. **`ifc-extract-systems` edge function crashes** on larger IFC files (19MB+) due to WASM memory limits. This is the primary hierarchy source for server-side conversion.

2. **Browser-side hierarchy extraction produces empty results**: `convertToXktWithMetadata` in `acc-xkt-converter.ts` extracts levels/spaces from `xktModel.metaObjects`, but the IFC parser may not populate `metaObjects` for all IFC schemas. If `metaObjects` is empty or has no `IfcBuildingStorey`/`IfcSpace` types, the hierarchy code silently produces nothing.

3. **No fallback when both paths fail**: There's no retry mechanism or metadata-file-based fallback in the browser path. The `_metadata.json` IS uploaded (line 460-466) but never consumed as a fallback source.

4. **Job status not reflecting reality**: The latest job for building 01 is `pending` but a newer XKT exists — the browser conversion created a new job row vs updating the existing one, or the status update at line 582 failed silently.

## Fix Plan

### 1. Harden browser hierarchy extraction with metadata fallback
In `CreateBuildingPanel.tsx` `runBrowserConversion`, after the primary extraction:
- If `result.levels.length === 0`, attempt to read hierarchy from the uploaded `_metadata.json` by scanning `metaModelJson.metaObjects` for `IfcBuildingStorey` and `IfcSpace` entries.
- Add explicit logging when hierarchy is empty: `log('⚠️ No levels/spaces found in IFC metadata')`.

### 2. Add a lightweight hierarchy-from-metadata edge function path
Extend `ifc-extract-systems` with a `mode: 'metadata-only'` that reads the `_metadata.json` file from storage instead of re-parsing the full IFC. This avoids the WASM memory crash entirely. The browser conversion already uploads this file.

### 3. Auto-trigger metadata fallback after WORKER_LIMIT
In `CreateBuildingPanel.tsx` line 306-324, when the `ifc-extract-systems` call fails, immediately retry with `mode: 'metadata-only'` using the metadata JSON path.

### 4. Fix job status tracking
Ensure `runBrowserConversion` updates the correct job ID to `done` (line 582 already does this — verify it's not silently failing due to RLS).

### 5. Wire 3D viewer to load models from storage
The XKT model exists in `xkt_models` table. The `NativeXeokitViewer` already reads from this table. The issue is likely that without storeys, the viewer's floor-switching logic may not initialize properly. Ensure the viewer can display models even when no hierarchy exists.

## Files to Edit
1. `src/components/settings/CreateBuildingPanel.tsx` — Fallback hierarchy extraction + retry logic
2. `supabase/functions/ifc-extract-systems/index.ts` — Add `metadata-only` mode
3. `src/components/viewer/NativeXeokitViewer.tsx` — Verify model loads without hierarchy

