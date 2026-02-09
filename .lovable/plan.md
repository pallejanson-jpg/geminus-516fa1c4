
# ACC BIM Sync: Chunked Processing, File Selection, Data Visibility & 3D Geometry

## Problems Identified

### Problem 1: Memory Limit on Large BIM Folders
The `acc-sync` edge function processes ALL BIM files in a folder in one request. For folders with 3+ large RVT files (like Jonkoping Science Tower), the Model Properties API response data exceeds the edge function's memory limit.

### Problem 2: No Per-File Selection
Currently "Synka BIM" syncs all BIM files in a folder at once. Users need to select which individual files to sync.

### Problem 3: Sync Reports Success But Data Not Visible
The Stadshuset Nykoping sync DID write data to the database (1 building, 7 levels, 456 rooms). Two issues prevent visibility:
- **Room names are GUIDs** (e.g., "Room cc6a4d6a-7a4f-4ece-afb2-b928348196d7-0039a7bb") because the Model Properties API returns `externalId` as the name when the actual room name/number is stored in a different property key
- **Level names are GUIDs** (e.g., "Level 443b7e69-0982-4ee8-91ef-73827a50caec-002ac9fa") - same issue
- The building DOES appear in the Navigator tree but with ugly GUID-named children

### Problem 4: No 3D Geometry (XKT)
The BIM sync only extracts hierarchy metadata (levels/rooms) via Model Properties API. It does not download geometry for 3D viewing. Options for getting 3D viewable data:

**Option A: Autodesk Model Derivative API -> SVF2 -> xeokit-convert -> XKT**
- Use Model Derivative API to translate the RVT file to SVF2 format
- Download the SVF2 derivative files
- Use `@xeokit/xeokit-convert` (Node.js) to convert SVF2/glTF to XKT
- Store XKT in storage bucket
- This is the approach described in the project's existing strategy docs

**Option B: Autodesk Viewer SDK (embedded)**
- Embed the Autodesk Viewer directly instead of converting
- Requires loading the Autodesk Viewer JS SDK
- Simpler but breaks the "unified xeokit experience" goal

**Recommendation:** Option A aligns with the existing strategy (`memory: integrations/autodesk-construction-cloud/3d-viewer-strategy`), but the SVF2-to-XKT conversion requires a Node.js runtime (not available in Deno edge functions). This would need an external conversion service or a scheduled job. This is a significant effort and should be planned separately.

---

## Plan

### Phase 1: Fix Data Quality (Room/Level Names)

**File: `supabase/functions/acc-sync/index.ts`** - `extractBimHierarchy` function

The current code uses `p153cb174` (Name property) which returns the Revit internal name (often just "Room" or empty). For rooms, the actual room name and number are in different property keys. Fix:

- After fetching `fieldsMap`, look for additional keys: "Number" (`p20d8441e` or similar), "Room Name", "Room Number"
- For rooms: use `Number + " " + Name` pattern (e.g., "101 Korridor") instead of `externalId`
- For levels: the Name key usually works, but fall back to looking for "Elevation" to construct a meaningful name
- If no human-readable name is found, use `"Room " + objectId` or `"Level " + objectId` instead of the long GUID

### Phase 2: Per-File Selection in Folder Browser

**File: `src/components/settings/ApiSettingsModal.tsx`** - `AccFolderNode` component

- Add checkboxes next to each BIM file in the folder tree
- Track selected files in state: `selectedBimFiles: Map<folderId, Set<itemId>>`
- Change "Synka BIM" button to only send selected files (or all if none selected)
- Show count of selected files on the button

### Phase 3: Chunked BIM Sync (One File at a Time)

**File: `supabase/functions/acc-sync/index.ts`** - `sync-bim-data` action

- Accept an optional `singleFile` flag or process one `versionUrn` at a time
- When multiple files are provided, use `EdgeRuntime.waitUntil()` to process in background
- Return immediately with a job status that the client can poll

**File: `src/components/settings/ApiSettingsModal.tsx`** - `handleSyncBimData`

- When syncing a folder with multiple files, send them one at a time sequentially from the client
- Show per-file progress (e.g., "Synkar fil 2/3: 12015A_2023.rvt")
- If one file fails (memory limit), continue with the next and report partial results

### Phase 4: 3D Geometry Investigation (Separate Effort)

This requires:
1. Model Derivative API translation (RVT -> SVF2) - can be triggered from edge function
2. SVF2 download and XKT conversion - needs Node.js runtime
3. Storage of resulting XKT files

This is too large for this change and should be a separate task. For now, add a note/status in the UI indicating "3D-modell ej tillganglig" for ACC-sourced buildings.

---

## Technical Changes

| File | Change |
|---|---|
| `supabase/functions/acc-sync/index.ts` | Fix room/level naming in `extractBimHierarchy`; refactor `sync-bim-data` to process one file at a time |
| `src/components/settings/ApiSettingsModal.tsx` | Add per-file checkboxes in `AccFolderNode`; sequential per-file sync in `handleSyncBimData` with progress |

## Summary of Approach

1. **Fix naming** so synced data is actually usable (rooms show "101 Korridor" not GUIDs)
2. **Add file selection** so users choose which RVT/IFC files to sync
3. **Client-side sequential sync** (one file per edge function call) to avoid memory limits
4. **Defer 3D geometry** to a separate task since it requires Node.js conversion infrastructure
