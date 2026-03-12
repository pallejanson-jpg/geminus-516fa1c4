

# Plan: Fix 6 Viewer Issues

## 1. Properties Dialog Shows Only BIM Metadata

**Root cause:** In `NativeViewerShell.tsx` line 691, the dialog receives `fmGuid = metaObj.originalSystemId` which is the raw xeokit entity ID. This often doesn't match the `fm_guid` in the `assets` table (different casing, format, or the entity simply wasn't synced). When the DB query returns 0 results, `UniversalPropertiesDialog` falls back to basic BIM metadata.

**Fix:** In `UniversalPropertiesDialog.tsx`, expand the lookup strategy:
- Also search by `entityId` as a potential `fm_guid` match
- Try case-insensitive match on the `name` field as additional fallback
- Query `asset_external_ids` table for the entity ID to find the correct `fm_guid`
- If the entity has property sets in xeokit metaScene, display those alongside the BIM fallback (currently only basic fields are shown)

**Files:** `src/components/common/UniversalPropertiesDialog.tsx` (lines 138-200)

## 2. Section Tool Auto-Sections Instead of Manual Handle

**Root cause:** In `ViewerToolbar.tsx` lines 503-538, the section tool uses `SectionPlanesPlugin` with a fallback to a simple click-to-create-plane approach. There's no drag handle / gizmo for repositioning the section plane after creation. The `SectionPlanesPlugin` has a `.control` property that should provide interactive gizmos but `overviewVisible: false` may be suppressing it.

**Fix:** 
- Set `overviewVisible: true` on the SectionPlanesPlugin to enable the interactive control widget
- After creating a section plane, call `sectionPluginRef.current.showControl(sectionPlane.id)` to display drag handles
- Add a "flip" button next to "Clear sections" to flip the active plane direction

**File:** `src/components/viewer/ViewerToolbar.tsx` (lines 503-553)

## 3. FastNav Setting Not Respected

**Root cause:** `NativeXeokitViewer.tsx` line 202 always installs `FastNavPlugin` regardless of the user setting stored in `localStorage` via `getFastNavEnabled()` (defined in `VoiceSettings.tsx`). The setting switch works but is never read during viewer init.

**Fix:** Import `getFastNavEnabled` and gate FastNav installation:
```
if (sdk.FastNavPlugin && getFastNavEnabled()) {
  new sdk.FastNavPlugin(viewer, { ... });
}
```

**File:** `src/components/viewer/NativeXeokitViewer.tsx` (lines 200-211)

## 4. bim-to-gltf Runtime Error

**Root cause:** The edge function uses `web-ifc` WASM which requires filesystem access that may not work in the Deno edge function environment (same issue seen in `ifc-to-xkt`). The error shows `RUNTIME_ERROR` with `lineno: 0` suggesting a WASM initialization crash. No logs are recorded, confirming the function crashes before any logging.

**Fix:** Add the same WASM download-and-redirect pattern used in `ifc-to-xkt/index.ts` (the `ensureWasm()` function). The `bim-to-gltf` function needs to download `web-ifc.wasm` to `/tmp` and redirect `Deno.readFileSync` before using `web-ifc`.

**File:** `supabase/functions/bim-to-gltf/index.ts` (add `ensureWasm()` from `ifc-to-xkt`)

## 5. Building A1 Issues: Double Spinner, No Structure in Navigator, Not in Portfolio

**Root cause (double spinner):** Both `NativeXeokitViewer` (line 1245) and `NativeViewerShell` may show overlapping loading states. The shell doesn't gate its own loading indicator against the viewer's phase.

**Root cause (no structure):** The IFC import via browser conversion creates `xkt_models` entries but may not have run the `populateAssetsFromMetaObjects` step that creates storeys/spaces/instances in the `assets` table. Without assets, Portfolio and Navigator show nothing.

**Fix:**
- **Double spinner:** In `NativeViewerShell.tsx`, don't show an additional loading state — rely on the viewer's own overlay
- **Missing structure:** After browser IFC conversion, ensure the client triggers the `ifc-extract-systems` edge function with `mode: 'enrich-guids'` to populate the assets table hierarchy. Add a post-conversion call in `CreateBuildingPanel.tsx`'s `runBrowserConversion`.
- **Swedish labels:** Translate `CreateBuildingPanel.tsx` labels to English per the language standardization memory

**Files:** `src/components/viewer/NativeXeokitViewer.tsx`, `src/components/settings/CreateBuildingPanel.tsx`

## 6. Batch XKT Worker for All Buildings

**Current state:** The XKT worker polls for `conversion_jobs` with status `pending`. It processes one job at a time. There's no UI to queue all buildings at once.

**Fix:** Add a "Re-process all buildings" button in Settings → Buildings that:
1. Queries all buildings with IFC files in `ifc-uploads` storage
2. Creates a `conversion_jobs` entry for each building
3. The existing worker picks them up automatically via polling

**File:** `src/components/settings/CreateBuildingPanel.tsx` (add batch action), `supabase/functions/conversion-worker-api/index.ts` (add `POST /batch-enqueue` action)

---

## Implementation Order
1. FastNav setting fix (smallest, immediate UX win)
2. Properties dialog lookup improvement
3. Section tool gizmo handles
4. Double spinner fix + English labels
5. bim-to-gltf WASM fix
6. Post-conversion asset population for Building A1
7. Batch XKT worker enqueue

