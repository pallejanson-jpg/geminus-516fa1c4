

# Fix ACC Folder Contents: Files Not Showing in "01 Modeller"

## Problem

The ACC integration lists folders correctly but shows no files inside "01 Modeller". This is caused by two issues in the current `list-folders` action in `acc-sync`:

1. **No pagination** -- The Data Management API paginates results and applies pagination *before* filtering. The current code makes a single request and never follows `links.next`, so it may get an empty first page or miss items entirely.
2. **No recursive folder traversal** -- If "01 Modeller" contains sub-folders (common in ACC where models are organized in nested structures), the code only looks one level deep and won't find files in child folders.
3. **Cloud Models (C4RModel)** -- ACC often stores Revit files as "Cloud Models" with a different extension type (`items:autodesk.bim360:C4RModel`). These may require different handling than regular uploaded items.

## Solution

### 1. Add Pagination to Folder Contents Fetching

In `supabase/functions/acc-sync/index.ts`, create a helper function `fetchAllFolderContents` that follows `links.next` until no more pages exist:

```text
fetchAllFolderContents(token, projectId, folderId, regionHeaders)
  -> GET /data/v1/projects/{pid}/folders/{fid}/contents
  -> Follow links.next until exhausted
  -> Collect all data[] items and included[] metadata
  -> Return combined results
```

### 2. Add Recursive Sub-folder Traversal

When listing a folder's contents, if sub-folders are found inside (e.g., "01 Modeller" contains year-folders or discipline-folders), recursively fetch their contents too. Limit recursion depth to 3 levels to avoid infinite loops.

### 3. Handle Cloud Models

Recognize items with extension type `items:autodesk.bim360:C4RModel` as BIM files. These are Revit Cloud Worksharing models that should be treated the same as `.rvt` files for BIM sync purposes.

## Technical Changes

### File: `supabase/functions/acc-sync/index.ts`

**New helper function**: `fetchAllFolderContents(token, projectId, folderId, regionHeaders)`
- Fetches folder contents with full pagination (follow `links.next`)
- Returns `{ items: [], folders: [], included: [] }`

**Modified `list-folders` action** (line 1116):
- Replace single `fetch` calls with `fetchAllFolderContents`
- Add recursive traversal for nested sub-folders (max depth 3)
- Include Cloud Model type detection (`items:autodesk.bim360:C4RModel` and `items:autodesk.bim360:File`)
- Return nested folder structure so the UI can display the full hierarchy

**Modified `isBimFile` function** (line 522):
- Also return true for items with Cloud Model extension types, not just file extension matching

### File: `src/components/settings/ApiSettingsModal.tsx`

- Update folder display to support nested sub-folders (show expandable tree)
- Show item count per folder including nested items

## Files to Modify

| File | Change |
|---|---|
| `supabase/functions/acc-sync/index.ts` | Add pagination helper, recursive folder traversal, Cloud Model support |
| `src/components/settings/ApiSettingsModal.tsx` | Support nested folder display in UI |

