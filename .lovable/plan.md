

## Plan: FM Access Hierarchy Auto-Creation via Sync + Vector Drawing Support

### Status: Part 1 IMPLEMENTED ✅ | Part 2 (Drawing API) ready for testing

### What was implemented

1. **`ensure-hierarchy` action** in `supabase/functions/fm-access-query/index.ts`:
   - Checks if building exists by GUID in FM Access
   - If not found: creates Fastighet (102) → Byggnad (103) → Plan (105) → Rum (107)
   - Uses `systemGuid` to preserve Geminus GUIDs
   - Updates `building_settings.fm_access_building_guid`

2. **`ensureFmAccessHierarchy()`** in `src/services/fm-access-service.ts`:
   - Queries local assets for building, levels (category='Level'), rooms (category='Space')
   - Calls the new ensure-hierarchy action

3. **Updated `handleSyncToFmAccess`** in `ApiSettingsModal.tsx`:
   - Groups assets by `building_fm_guid`
   - Calls `ensureFmAccessHierarchy` for each unique building BEFORE syncing objects
   - Removed `fmAccessLocalCount === 0` disable condition
   - Reports hierarchy creation + object sync results separately

4. **`discover-drawing-api` action** added to edge function:
   - Probes `/api/drawings`, `/api/files`, `/api/files/upload`, `/api/config/classes` endpoints
   - Returns status codes, headers, and response snippets for each

### Next Steps (Phase B)

- Run `discover-drawing-api` to understand drawing upload capabilities
- Implement IFC → SVG floor plan extraction using web-ifc
- Upload drawings as Ritning (classId 106) under each Plan
