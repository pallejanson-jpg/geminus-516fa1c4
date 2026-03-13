

## Plan: UI/Data Fixes — Area, Mobile Duplicates, Properties, Charts, Viewer Navigation

### Issues Found

---

### 1. Area Summation Shows 0 / N/A

**Root Cause:** `fetchLocalAssets()` in `asset-plus-service.ts` (line 29) does NOT select `gross_area` from the database. The mapped objects never get a `grossArea` property. As a result:

- `FacilityLandingPage` KPIs (line 198): `facility.area` is always undefined → shows "N/A"
- `BuildingInsightsView` stats (line 430-442): tries `space.grossArea` as fallback, but it's never set → area stays 0

**Fix in `asset-plus-service.ts`:**
- Add `gross_area` to the select query in both `fetchLocalAssets` and `fetchAssetsForBuilding`
- Map it: `grossArea: asset.gross_area`

**Fix in `FacilityLandingPage` KPIs (line 197-210):**
- Instead of relying on `facility.area` (which doesn't exist), sum `grossArea` from `childSpaces` (same approach as BuildingInsightsView)
- For storeys: sum child spaces' grossArea
- For spaces: use the space's own grossArea

**Fix in `BuildingInsightsView` stats (line 430-442):**
- The NTA attribute lookup logic is fine as fallback, but now `space.grossArea` will actually have values

---

### 2. Mobile: Duplicate Favorite Icon + Unknown Settings Icon

**Root Cause:** `FacilityLandingPage` renders the favorite star **twice**:
1. **Top-right floating** (line 380-398): Star + Settings2 buttons in absolute position over the hero image
2. **Inside Basic Info Card header** (line 447-473): Star + Settings2 + Table buttons again

On small screens both are visible simultaneously → confusing duplicate icons.

**Fix:**
- Remove the Star and Settings2 buttons from the Basic Info Card header (lines 448-470), keep only the "View all properties" (Table) button there
- The floating top-right buttons already handle these actions

---

### 3. Properties Dialog: Duplicate Close Buttons

**Root Cause:** `UniversalPropertiesDialog` desktop view (line 1238-1262) renders:
1. An `ArrowLeft` button (line 1246) — back/close
2. An `X` button (line 1255) — also close

Both do `onClose()`. Two close buttons is redundant.

Mobile Sheet (line 1220-1231) also has an X button in the SheetHeader alongside the Sheet's own close mechanism.

**Fix:**
- Desktop: Remove the `ArrowLeft` back button, keep only the X button (consistent with other panels)
- Mobile: The Sheet already has drag-to-close, the explicit X button is fine to keep (it's inside the header alongside the title)

---

### 4. Properties Dialog Consistency with Viewer

The `UniversalPropertiesDialog` is already used in the Viewer via `NativeViewerShell.tsx` — this is correct. The same component is used in `FacilityLandingPage` as well. No action needed here — it's already the same component.

---

### 5. Annotations Analysis

**Alarm annotations in Insights FM tab:** The "View all in 3D" button (line 1176-1187) dispatches `ALARM_ANNOTATIONS_SHOW_EVENT`. This works when Insights is in drawer mode inside the viewer. But when standalone, it dispatches the event to nobody — no viewer is listening. Same issue as #7.

**Annotations in VisualizationToolbar:** The toolbar integrates `AnnotationCategoryList` which handles annotation visibility. This should work correctly within the viewer context.

**Fix:** When Insights is standalone (not drawer mode), the alarm "View all in 3D" buttons should navigate to the viewer instead of dispatching events. Same fix as #7.

---

### 6. Room Visualization from VisualizationToolbar

The toolbar triggers `FORCE_SHOW_SPACES_EVENT` and manages `RoomVisualizationPanel`. This works within the viewer context. No issues found in the code path — the toolbar correctly passes viewer refs and building GUID. If it's not working, it's likely because `buildingFmGuid` prop is missing on the toolbar — let me verify this is wired up correctly in `NativeViewerShell`.

Already verified: `NativeViewerShell` passes `buildingFmGuid` to `VisualizationToolbar`. This should work.

---

### 7. Insights View Buttons → Viewer Don't Work

**Root Cause:** The KPI card "View" buttons use `navigateTo3D()` which navigates to `/split-viewer?building=...`. `SplitViewer` redirects to `/viewer?building=...`. The Viewer reads `building` from searchParams.

The issue is that `facility.fmGuid` could be undefined when the Facility object was created from `navigatorTreeData` without a proper fmGuid, OR the navigation is working but the viewer takes time to load (perceived as "not starting").

More likely root cause: when `handleInsightsClick` is called in non-drawer, non-mobile (desktop) mode, it only updates `inlineInsightsMode` and dispatches events — it does NOT navigate. The inline viewer (`InsightsInlineViewer`) is only rendered when `!drawerMode && !isMobile` AND it requires the component to be already mounted. The issue is the **KPI cards** (floors, rooms, assets, area) use `navigateTo3D()` which navigates away, but `navigateTo3D` navigates to `/split-viewer` which redirects to `/viewer` — and the `viewer` page needs `building` param to load. This SHOULD work if `facility.fmGuid` exists.

Let me check: the "View" link on each KPI card calls `navigateTo3D()` (line 673-674). But the `ViewerLink` icons on chart cards call `handleInsightsClick` which works differently.

Actual fix: Ensure `navigateTo3D` and `navigateToInsights3D` use `/viewer` directly (skip `/split-viewer` redirect) for faster load. Also add a guard: if `facility.fmGuid` is falsy, show a toast instead of navigating.

---

### 8. Pie Chart Values — Room Types, Asset Categories, Energy Distribution

**Room Types pie:** Currently shows `name percentage%` via `renderPieLabel`. Missing: count and area per type.

**Fix in `spaceTypePie` memo:** Add `area` field by summing `grossArea` for each type. Update `renderPieLabel` to show `name (count) area m²`.

**Asset Categories pie:** Currently shows `name percentage%`. Missing: count per category.

**Fix:** Update `renderPieLabel` to show `name (count)`.

**Energy Distribution pie:** Currently shows `name percentage%` with mock percentages. Labels should show actual values.

**Fix:** Update `renderPieLabel` or use a custom label that includes the value (e.g., "Heating 42%").

**General approach:** Create a custom `renderPieLabel` function per chart that includes the relevant value data.

---

### 9. Area Showing 0

Already covered in #1 — the root cause is missing `gross_area` in the select query. Once fixed, areas will populate correctly across:
- FacilityLandingPage KPIs
- BuildingInsightsView stats
- SpaceManagementTab
- PerformanceTab

---

### Technical Changes

**Files to modify:**

1. **`src/services/asset-plus-service.ts`**
   - Add `gross_area` to select in `fetchLocalAssets` and `fetchAssetsForBuilding`
   - Map to `grossArea` in the response

2. **`src/components/portfolio/FacilityLandingPage.tsx`**
   - Remove duplicate Star + Settings2 buttons from Basic Info Card header (keep only Table/properties button)
   - Fix KPI area calculation: sum `grossArea` from `childSpaces` instead of relying on `facility.area`

3. **`src/components/common/UniversalPropertiesDialog.tsx`**
   - Desktop: Remove the ArrowLeft back button, keep only X button

4. **`src/components/insights/BuildingInsightsView.tsx`**
   - Update `renderPieLabel` for Room Types: show `name (count)`
   - Add area sum per room type to `spaceTypePie` data and show in CardDescription
   - Update Asset Categories pie label: show `name (count)`
   - Update Energy Distribution pie label: show `name value%`
   - Fix `navigateTo3D` and `navigateToInsights3D`: navigate to `/viewer` directly, add fmGuid guard
   - Alarm "View in 3D" buttons: when not in drawerMode, navigate to viewer instead of dispatching events

5. **`src/lib/types.ts`** — No change needed, `Facility` already has `area` and `grossArea` fields (grossArea from the entity, not the type — but it's used via allData objects, not the Facility type directly)

