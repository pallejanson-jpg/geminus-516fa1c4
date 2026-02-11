

# Fix: BIM Sync from ACC Error

## Problem

When clicking "Synka BIM" in the ACC settings, an error message appears. Based on code analysis:

- No `sync-bim-data` edge function logs exist, suggesting the error may occur client-side before the API call, OR the edge function crashes before logging the action.
- The most likely causes are:

1. **Missing `versionUrn`**: Cloud Models (C4RModel) may not expose `relationships.tip.data.id`, causing all items to have `versionUrn: null`. The client-side filter `filter((item: any) => item.versionUrn)` then removes all items and shows "Inga BIM-filer".

2. **Edge function timeout**: The `extractBimHierarchy` function polls Autodesk's indexing API for up to 45 seconds. Combined with auth, field parsing, and database upserts, this can exceed the edge function's execution limit.

3. **Missing error details**: When the edge function returns `{ success: false }`, the error message shown to the user may be generic or unhelpful.

## Solution

### 1. Fix `versionUrn` extraction for Cloud Models

In `supabase/functions/acc-sync/index.ts`, the `mapItem` function extracts `versionUrn` only from `item.relationships.tip.data.id`. For Cloud Models, try alternative paths:
- Check `included` array for version data matching the item's `id`
- Use `item.relationships.versions.links.related.href` to find the latest version
- Fall back to item's own `id` if it starts with `urn:adsk.wipprod:dm.lineage:`

### 2. Add detailed client-side error logging

In `src/components/settings/ApiSettingsModal.tsx`:
- Log the full error response body in the console when sync fails
- Show the actual server error message in the toast (not just `err.message`)
- Log the items being sent (count, whether they have versionUrn) before calling the edge function

### 3. Add edge function timeout protection

In `supabase/functions/acc-sync/index.ts` sync-bim-data action:
- Reduce the polling timeout from 45s to 30s to leave room for processing
- Add a try/catch around the initial `getAccToken` call with a descriptive error
- Log the action name immediately after parsing the body (before auth token retrieval)

### 4. Improve error messages

- When `bimItems.length === 0`, include file names and whether they had `versionUrn` in the error message
- When the edge function returns a non-success response, display the actual error text from the server

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/acc-sync/index.ts` | Fix versionUrn extraction in `mapItem`, reduce poll timeout, add early action logging |
| `src/components/settings/ApiSettingsModal.tsx` | Better error messages, console logging for debugging |

## Technical Details

The `mapItem` function change (line ~1558):

```text
Before:
  const versionUrn = item.relationships?.tip?.data?.id || null;

After:
  let versionUrn = item.relationships?.tip?.data?.id || null;
  // For Cloud Models, try finding version in included array
  if (!versionUrn && included.length > 0) {
    const relatedVersion = included.find(v =>
      v.type === 'versions' && v.relationships?.item?.data?.id === item.id
    );
    if (relatedVersion) versionUrn = relatedVersion.id;
  }
```

The client-side error improvement (line ~703):

```text
Before:
  toast({ variant: 'destructive', title: 'Inga BIM-filer',
    description: 'Denna mapp innehaller inga BIM-filer med versionUrn.' });

After:
  const allItems = selectedFiles || folder.items || [];
  const bimWithoutUrn = allItems.filter(i => i.isBim && !i.versionUrn);
  toast({ variant: 'destructive', title: 'Inga BIM-filer',
    description: bimWithoutUrn.length > 0
      ? 'Hittade ${bimWithoutUrn.length} BIM-fil(er) men utan version-URN. Filerna kan vara Cloud Models som kräver direkt API-åtkomst.'
      : 'Denna mapp innehaller inga BIM-filer.' });
```

