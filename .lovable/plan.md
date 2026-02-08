

# Comprehensive Fixes: Grid Styling, 3D Mobile, Insights with Real Data

This plan addresses multiple areas: visual consistency between Rooms and Assets grids, 3D mobile loading fixes, Insights real data integration, and navigation improvements.

---

## 1. Assets Grid -- Match Rooms View Styling + Mobile Fix

**Problem:** AssetsView header, toolbar, and table lack the compact responsive classes that RoomsView has. The `border rounded-lg` on the table wrapper only shows border on the left side on mobile because it overflows horizontally without proper containment.

**Changes in `src/components/portfolio/AssetsView.tsx`:**

- Match the header pattern from RoomsView: use `px-2 sm:px-3 md:px-4 py-2 sm:py-3` instead of `px-4 py-3`
- Match the search input: use `pl-7 sm:pl-9 h-8 sm:h-9 text-xs sm:text-sm` instead of `pl-9 h-9`
- Match icon sizes: use `h-4 w-4 sm:h-5 sm:w-5` instead of `h-5 w-5`
- Match title sizes: `text-sm sm:text-base md:text-lg font-bold truncate` instead of `font-semibold text-lg`
- Match close button: `h-8 w-8 sm:h-9 sm:w-9` instead of default
- Match toolbar: `px-2 sm:px-3 md:px-4 py-1.5 sm:py-2 flex gap-1.5 sm:gap-2` instead of `px-4 py-2`
- Match table wrapper: add `overflow-hidden` to parent and ensure border wraps properly on mobile
- Match table cell text: `text-[11px] sm:text-sm` in TableCell for compact mobile rendering
- Fix `min-w-[200px]` on search input to `min-w-0` to prevent overflow on small screens
- Match gallery grid: use `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` to match RoomsView's gallery layout (currently uses `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5`)
- Add gallery card gradient header matching RoomsView (with icon and level badge)

---

## 2. 3D Mobile Fix -- Remove XKT Preloading

**Problem:** The 3D viewer is not rendering on mobile. The user suspects XKT preloading may be interfering. On mobile, the `useXktPreload` hook fetches model data into memory before the viewer loads, potentially consuming all available memory before the viewer even starts, or causing race conditions with model loading.

**Changes:**

- **`src/hooks/useXktPreload.ts`**: Add mobile detection at the start of the hook. On mobile devices, skip all preloading entirely to avoid memory competition with the viewer:
  ```text
  export function useXktPreload(buildingFmGuid: string | null | undefined) {
    const preloadStartedRef = useRef(false);
    useEffect(() => {
      if (!buildingFmGuid) return;
      // Skip preloading on mobile to prevent memory competition with 3D viewer
      const isMobile = window.innerWidth < 768 || /Android|iPhone|iPad/i.test(navigator.userAgent);
      if (isMobile) return;
      // ... rest of preloading logic
    }, [buildingFmGuid]);
  }
  ```
  This is the least invasive change -- it keeps preloading working on desktop where memory is abundant.

---

## 3. Insights -- Back Button on Mobile

**Problem:** When navigating to BuildingInsightsView, the back button exists but there is no way to navigate back from the main Insights tabs on mobile (no header visible in immersive mode).

**Changes in `src/components/insights/InsightsView.tsx`:**
- The main InsightsView is shown inside AppLayout, so the AppHeader and MobileNav provide navigation. No change needed for the main view.
- For `BuildingInsightsView`, the back button already exists. Verified it renders correctly.
- For `EntityInsightsView`, the back button already exists.

**No changes needed** -- the back buttons are already present in both BuildingInsightsView and EntityInsightsView.

---

## 4. Insights -- Real Data Integration + Mockup Color Coding

This is the largest change. The goal is to replace mockup values with real data from the database, color-code mockup values as purple and real values as white, and make real values clickable.

### 4a. AssetManagementTab Real Data

**File:** `src/components/insights/tabs/AssetManagementTab.tsx`

Current state: Uses `allData` for total asset count, but **hardcoded pie chart** for category distribution and **hash-based random** for per-building counts.

**Changes:**
- **"Assets by Category"** pie chart: Replace hardcoded `categoryDistribution` with real data computed from `allData`. Group by `assetType` (e.g., IfcDoor, IfcWindow, IfcWall, etc.), take top 6 categories, rest as "Other". Mark as **real data (white text)**.
- **"Assets per Building"** bar chart: Replace hash-based `assetCount` with real counts from `allData` grouped by `buildingFmGuid`. Match building names from `navigatorTreeData`. Mark as **real data (white text)**.
- **"Asset Overview per Building"** table: Replace mockup counts with real per-building asset counts. Keep avg age, value, and maintenance status as **purple (mockup)**. Make the Count column **clickable** -- navigates to Assets list for that building.
- **KPI "Total Assets"**: Already uses real data from allData -- mark as **white**.
- **KPI "Average Age"**: Mockup -- mark as **purple**.
- **KPI "Replacement Value"**: Mockup -- mark as **purple**.
- **KPI "Needs Maintenance"**: Mockup -- mark as **purple**.

### 4b. SpaceManagementTab Real Data

**File:** `src/components/insights/tabs/SpaceManagementTab.tsx`

Current state: Uses `navigatorTreeData.children` for space counts and area (works since it's a tree). Uses hash-based random for occupancy/vacancy.

**Changes:**
- **KPI "Total Rooms"**: Already real -- from tree traversal counting spaces. Mark **white**.
- **KPI "Total Area"**: Already real -- from NTA attributes. Mark **white**.
- **KPI "Average Occupancy"**: Mockup. Mark **purple**.
- **KPI "Avg. Vacancy Rate"**: Mockup. Mark **purple**.
- **"Space Efficiency per Building"** section: The `spaceCount` and `totalArea` are real. The `occupancy` percentage is mockup. Show room count and area in **white**, occupancy bar/badge in **purple**.
- **"Occupancy per Building"**: All mockup. Mark **purple**.
- **"Room Types"** pie chart: Already real (from space attributes). Mark **white**.
- Make **"Total Rooms" KPI clickable** -- navigate to Rooms list.

### 4c. PerformanceTab

**File:** `src/components/insights/tabs/PerformanceTab.tsx`

Current state: Uses `navigatorTreeData` tree for building/room/area counts (real). Energy data is hash-based (mockup).

**Changes:**
- **KPI "Building Count"**: Already real. Mark **white**. Make clickable to Portfolio.
- **KPI "Avg. Energy"**: Mockup. Mark **purple**.
- **KPI "CO2 Emissions"**: Mockup. Mark **purple**.
- **KPI "Avg. Energy Rating"**: Mockup. Mark **purple**.
- **Building list cards**: Building names are real. Energy rating/kWh are mockup. Name in **white**, energy data in **purple**.
- All chart data is mockup -- mark **purple**.

### 4d. FacilityManagementTab

**File:** `src/components/insights/tabs/FacilityManagementTab.tsx`

All data is mockup (generated work orders). Mark all values **purple**.

### 4e. PortfolioManagementTab

**File:** `src/components/insights/tabs/PortfolioManagementTab.tsx`

Building names and areas are real. Financial data (value, rent, ROI) is mockup. Names/area in **white**, financial data in **purple**.

### Color Coding Implementation

Add a utility component/class for distinguishing real vs mockup values:

```text
// In each tab, wrap mockup values:
<span className="text-purple-400">{mockupValue}</span>

// Real values use default foreground:
<span className="text-foreground">{realValue}</span>
```

For KPI cards, add a small indicator:
- Real data: no indicator (default styling)
- Mockup data: purple text color on the value + a small "Demo" badge

### Clickable Real Values

Add `onClick` handlers to real-data KPIs and table cells that navigate to the relevant detail views:
- Total Assets count --> navigate to Assets list (set `activeApp` to portfolio, select building, show assets)
- Total Rooms count --> navigate to Rooms list
- Asset count per building --> navigate to that building's assets
- Room count per building --> navigate to that building's rooms

This will use the existing `AppContext` patterns (`setActiveApp`, `setSelectedFacility`).

### Props Changes

- `AssetManagementTab`: Add `onNavigateToAssets?: (buildingFmGuid?: string) => void`
- `SpaceManagementTab`: Add `onNavigateToRooms?: (buildingFmGuid?: string) => void`
- These callbacks will be wired in `InsightsView.tsx` to set the appropriate app context.

---

## 5. Building/Floor/Room Level Insights Tabs

**Problem:** The per-building insights view (`BuildingInsightsView`) only shows energy charts. The user wants the same tab structure (Performance, FM, Space, Asset) at each hierarchy level.

**Changes in `src/components/insights/BuildingInsightsView.tsx`:**
- Replace the current single-view with a tabbed layout matching the main InsightsView
- Add Tabs: Performance, FM, Space, Asset
- Each tab filters data to the selected building's `fmGuid`
- Reuse the same data computation patterns but scoped to the building

**Changes in `src/components/insights/EntityInsightsView.tsx`:**
- Same tabbed layout for Floor and Room levels
- Scope data to `levelFmGuid` for floors, `inRoomFmGuid` for rooms

---

## File Summary

| File | Changes |
|------|---------|
| `src/components/portfolio/AssetsView.tsx` | Match RoomsView responsive styling, fix border overflow on mobile |
| `src/hooks/useXktPreload.ts` | Skip preloading on mobile devices |
| `src/components/insights/tabs/AssetManagementTab.tsx` | Replace mockup with real asset counts/categories, purple/white color coding, clickable values |
| `src/components/insights/tabs/SpaceManagementTab.tsx` | Mark real vs mockup values, purple/white coding, clickable room counts |
| `src/components/insights/tabs/PerformanceTab.tsx` | Mark real vs mockup values with color coding |
| `src/components/insights/tabs/FacilityManagementTab.tsx` | Mark all values as purple (mockup) |
| `src/components/insights/tabs/PortfolioManagementTab.tsx` | Mark real (names/area) vs mockup (financial) with color coding |
| `src/components/insights/BuildingInsightsView.tsx` | Add tabbed layout (Performance, FM, Space, Asset) with building-scoped data |
| `src/components/insights/EntityInsightsView.tsx` | Add tabbed layout for Floor/Room levels |
| `src/components/insights/InsightsView.tsx` | Wire navigation callbacks for clickable values |

## Risk Assessment

- **Assets grid**: Low risk -- pure styling alignment.
- **XKT preload skip on mobile**: Low risk -- mobile never had working preloading anyway (models loaded too much memory). Viewer will load models directly from API.
- **Insights real data**: Medium risk -- relies on `allData` having correct `assetType` and `buildingFmGuid` fields, which the database query confirms are populated.
- **Color coding**: Low risk -- pure visual change using Tailwind classes.
- **Clickable navigation**: Medium risk -- needs careful wiring through AppContext to navigate correctly.

