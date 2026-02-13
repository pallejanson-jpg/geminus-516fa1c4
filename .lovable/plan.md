

## Auto-resolve FM Access Building GUID via API Search

### Problem
Currently, the FM Access building GUID must be manually entered in settings. The user wants the system to automatically look it up using the building name via the FM Access API.

### Solution
Update the `get-viewer-url` action in the edge function to automatically search for the FM Access building when no `fmAccessBuildingGuid` is configured. It will:

1. Use the FM Access `search/quick` API with the building name
2. Find the best match from the results
3. Use that GUID to fetch the perspective tree and resolve the drawing
4. Optionally cache the resolved GUID back into `building_settings` for future speed

### Changes

**1. Edge Function: `supabase/functions/fm-access-query/index.ts`**

In the `get-viewer-url` action, add a new step before the perspective tree lookup:

```text
if (!fmAccessBuildingGuid && buildingName) {
  1. Call /api/search/quick?query={buildingName}
  2. Filter results for building-like objects (classId 104 or similar)
  3. Use the best match's GUID as fmAccessBuildingGuid
  4. Optionally: save it to building_settings via Supabase client
}
```

**2. Client: `src/components/viewer/FmAccess2DPanel.tsx`**
- Add `buildingName` prop
- Pass it to the edge function request body

**3. Client: `src/pages/UnifiedViewer.tsx`**
- Pass `buildingData.name` to `FmAccess2DPanel` as `buildingName`

**4. Client: `src/components/portfolio/QuickActions.tsx`**
- Add `buildingName` to the navigation URL as a query parameter

### Technical Details

The search flow in the edge function will be:

```text
get-viewer-url called with buildingName="Akerselva Atrium"
  -> No fmAccessBuildingGuid configured
  -> Call /api/search/quick?query=Akerselva Atrium
  -> Find matching object with GUID 755950d9-...
  -> Use that GUID for perspective tree lookup
  -> Cache GUID in building_settings for next time
  -> Continue with normal floor matching logic
```

The Supabase service role key is available in the edge function environment, so it can write the resolved GUID back to `building_settings.fm_access_building_guid` for caching.

### Files Changed
- `supabase/functions/fm-access-query/index.ts` -- add auto-search logic in `get-viewer-url`
- `src/components/viewer/FmAccess2DPanel.tsx` -- add `buildingName` prop
- `src/pages/UnifiedViewer.tsx` -- pass building name
- `src/components/portfolio/QuickActions.tsx` -- add building name to URL

