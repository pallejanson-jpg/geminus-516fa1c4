

# Fix 3D Viewer on Mobile, Insights Data, and Text Overflow

## Three Issues to Fix

### Issue 1: 3D Viewer Loads But Nothing Displays (Mobile and Desktop)

**Root Cause Found**: Callback identity instability causes the viewer to be torn down while still loading models.

The chain of events:

1. `initializeViewer` starts, which sets `cacheStatus` state to `'checking'`
2. `cacheStatus` is in the dependency array of `handleAllModelsLoaded`
3. When `cacheStatus` changes, `handleAllModelsLoaded` gets a new identity
4. `handleAllModelsLoaded` is in the dependency array of `initializeViewer`
5. `initializeViewer` gets a new identity
6. The `useEffect` that calls `initializeViewer` re-runs
7. The cleanup function runs: it calls `viewer.clearData()` and sets `viewerInstanceRef.current = null`
8. The Asset+ viewer was mid-loading XKT models -- now its data is wiped

The result: the viewer container appears (initialization started), but the 3D models never render because `clearData()` was called mid-load. On desktop, timing may allow models to finish loading before the cascade. On mobile, slower network/GPU means models are still loading when cleanup fires.

**Fix**: Remove volatile state variables from `handleAllModelsLoaded` dependencies by using refs instead.

```text
File: src/components/viewer/AssetPlusViewer.tsx

1. Add refs to track `cacheStatus` and `showNavCube`:
   - const cacheStatusRef = useRef(cacheStatus)
   - const showNavCubeRef = useRef(showNavCube)
   - Keep refs in sync with state via useEffect

2. In handleAllModelsLoaded, read from refs instead of state:
   - cacheStatusRef.current instead of cacheStatus
   - showNavCubeRef.current instead of showNavCube

3. Remove cacheStatus and showNavCube from handleAllModelsLoaded
   dependency array

4. This stabilizes initializeViewer's identity, preventing
   the effect from re-running and tearing down the viewer
   during model loading
```

Additionally, increase the mobile initialization timeout from 20 seconds to 30 seconds to give more time for model loading on slow connections.

---

### Issue 2: Insights Asset Count Shows Zero

**Root Cause Found**: `allData` in AppContext only loads hierarchy data at startup (Building, Building Storey, Space). Instance/asset category items are excluded for performance (lazy-loaded per building). But `AssetManagementTab` counts assets by filtering `allData` for items that are NOT Building/Storey/Space -- which returns zero because those are the only items loaded.

Database confirms: 82,558 Instance records, 2,731 Spaces, 60 Storeys, 11 Buildings. But `allData` only has ~2,802 items (hierarchy only).

**Fix**: Query the database directly for asset counts in Insights tabs, instead of relying on `allData`.

```text
File: src/components/insights/tabs/AssetManagementTab.tsx

1. Add a database query using supabase to count assets:
   - Total count: SELECT count(*) FROM assets 
     WHERE category NOT IN ('Building', 'Building Storey', 'Space', ...)
   - Per building: SELECT building_fm_guid, count(*) FROM assets
     WHERE category NOT IN (...) GROUP BY building_fm_guid
   - Category distribution: SELECT asset_type, count(*) FROM assets
     WHERE category NOT IN (...) GROUP BY asset_type

2. Use these counts instead of filtering allData

3. Show loading state while query runs, fallback to 0 on error
```

```text
File: src/components/insights/BuildingInsightsView.tsx

Same fix for the building-level Insights view:
- Query assets WHERE building_fm_guid = facility.fmGuid
  AND category NOT IN (hierarchy categories)
```

```text
File: src/components/insights/EntityInsightsView.tsx

Same fix for entity-level insights:
- Building: WHERE building_fm_guid = fmGuid
- Storey: WHERE level_fm_guid = fmGuid
- Space: WHERE in_room_fm_guid = fmGuid
```

---

### Issue 3: Text Overflow on Insights Pages

**Root Cause**: Several KPI card titles and chart labels are too long for mobile screens, especially when combined with the "Demo" badge.

**Fix**: Shorten titles on mobile and add text truncation.

```text
Files: All Insights tabs

1. KPI Card titles -- use shorter text on mobile:
   - "Average Age (years)" -> "Avg. Age" on mobile
   - "Replacement Value" -> "Value" on mobile  
   - "Needs Maintenance" -> "Maint." on mobile
   - "Average Occupancy" -> "Occupancy" on mobile
   - "Avg. Vacancy Rate" -> "Vacancy" on mobile
   - "CO2 Emissions (tons)" -> "CO2 (tons)" on mobile

2. Card title text: add truncate class and max-width
   to prevent overflow with Demo badge

3. KPI value text: ensure text-2xl doesn't overflow
   on small cards by using responsive text sizes
```

---

## File Summary

| File | Changes |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | Add refs for cacheStatus/showNavCube, stabilize handleAllModelsLoaded identity, increase mobile timeout to 30s |
| `src/components/insights/tabs/AssetManagementTab.tsx` | Query database directly for asset counts instead of filtering allData |
| `src/components/insights/BuildingInsightsView.tsx` | Query database for building-specific asset count |
| `src/components/insights/EntityInsightsView.tsx` | Query database for entity-specific asset count |
| `src/components/insights/tabs/SpaceManagementTab.tsx` | Responsive KPI labels |
| `src/components/insights/tabs/PerformanceTab.tsx` | Responsive KPI labels |
| `src/components/insights/tabs/PortfolioManagementTab.tsx` | Responsive KPI labels |
| `src/components/insights/tabs/FacilityManagementTab.tsx` | Responsive KPI labels |

## Risk Assessment

- **3D Viewer fix**: Low risk -- only changes callback dependency management (refs instead of state), keeping the same runtime behavior. If calibration offsets haven't been entered, the identity transform (no change) applies.
- **Insights data fix**: Low risk -- adds database queries that run alongside existing logic. Falls back to 0 if query fails. Does not affect data loading elsewhere.
- **Text overflow fix**: No risk -- purely visual CSS/label changes, no logic changes.

