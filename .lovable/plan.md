

## Fix FM Access 2D Drawing Resolution for Floors

### Problem
The "2D FMA" button navigates correctly but no drawing loads because:
- Asset+ GUIDs (used for buildings and floors) are not recognized by FM Access
- FM Access uses its own GUID namespace
- No mapping exists between the two systems

### Solution

#### 1. Database: Add FM Access building GUID mapping

Add `fm_access_building_guid` column to `building_settings` to store the FM Access GUID for each building.

```text
ALTER TABLE building_settings ADD COLUMN fm_access_building_guid TEXT;
```

For the Akerselva Atrium building, this would store `755950d9-f235-4d64-a38d-b7fc15a0cad9` (the GUID FM Access recognizes).

#### 2. Client: Pass floor name and FM Access building GUID

**`src/components/viewer/FmAccess2DPanel.tsx`**
- Add optional `floorName` prop
- Pass `floorName` to the edge function in the request body

**`src/pages/UnifiedViewer.tsx`**
- Read the `floorName` query parameter from the URL
- Pass it to `FmAccess2DPanel`
- Also look up `fm_access_building_guid` from `building_settings` and pass it to the panel

**`src/components/portfolio/QuickActions.tsx`**
- Include `floorName` in the navigation URL: `/split-viewer?building={buildingGuid}&mode=2d&floor={facility.fmGuid}&floorName={encodeURIComponent(facility.commonName)}`

#### 3. Edge Function: Use FM Access building GUID and match by name

**`supabase/functions/fm-access-query/index.ts`** (`get-viewer-url` action)
- Accept new params: `fmAccessBuildingGuid` and `floorName`
- Use `fmAccessBuildingGuid` (or fall back to `buildingId`) to fetch the building's perspective tree
- Find the floor node (classId 105) whose `objectName` matches `floorName`
- Get the first drawing (classId 106) under that floor
- Build the viewer URL with the drawing's `objectId`

#### 4. Settings UI: Allow configuring FM Access building GUID

**`src/components/settings/GeoreferencingSettings.tsx`** (or a dedicated FM Access settings section)
- Add an input field for "FM Access Building GUID"
- Save to `building_settings.fm_access_building_guid`

### Technical Details

The perspective tree for FM Access building GUID `755950d9-f235-4d64-a38d-b7fc15a0cad9` returns:
- Floor nodes (classId 105) like "Plan 1-5 Fasad", etc.
- Drawing nodes (classId 106) like "A00-0001", "A00-0002" under each floor

The floor name matching will be fuzzy (case-insensitive, trim whitespace) since Asset+ floor names (e.g., "01 Etasje") may not exactly match FM Access floor names. If no match is found, fall back to the first floor with drawings.

### Files Changed
- Migration: Add `fm_access_building_guid` column to `building_settings`
- `src/components/portfolio/QuickActions.tsx` - add `floorName` to URL
- `src/pages/UnifiedViewer.tsx` - read `floorName`, look up FM Access building GUID
- `src/components/viewer/FmAccess2DPanel.tsx` - accept and pass `floorName` and `fmAccessBuildingGuid`
- `supabase/functions/fm-access-query/index.ts` - use FM Access building GUID and match floor by name
- Settings component - add FM Access building GUID input
