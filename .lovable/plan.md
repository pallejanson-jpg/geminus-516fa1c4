

## Problem

1. **Missing ML tabs in BuildingInsightsView**: The building-level Insights view only has 4 tabs (Performance, Space, Asset, Alarms). The 3 ML tabs (🔮 Prediktivt, 📐 Optimering, 🔍 RAG Sök) exist only on the portfolio-level `InsightsView` and show "Välj en byggnad" because they read `selectedFacility` from AppContext — which isn't set when navigating via the Insights drill-down.

2. **"Visa" buttons don't work on mobile**: Clicking bar chart bars or alarm "Visa" buttons on mobile navigates to `/viewer?...` but the 3D colorization events aren't received because it's a full page navigation (events are lost).

## Plan

### 1. Make ML tabs accept a `facility` prop (3 files)

Update `PredictiveMaintenanceTab`, `RoomOptimizationTab`, and `RagSearchTab` to accept an optional `facility?: Facility` prop. When provided, use it instead of `selectedFacility` from AppContext. This lets them work both at portfolio level (existing behavior) and inside a building context.

- `PredictiveMaintenanceTab`: Add `facility` prop, use `facility?.fmGuid ?? selectedFacility?.fmGuid`
- `RoomOptimizationTab`: Same pattern
- `RagSearchTab`: Same pattern, pass `buildingFmGuid` from prop

### 2. Add ML tabs to BuildingInsightsView

In `src/components/insights/BuildingInsightsView.tsx`:
- Import the 3 ML tab components
- Add 3 new `TabsTrigger` entries (Prediktivt, Optimering, RAG Sök) to the existing tab list
- Add 3 corresponding `TabsContent` blocks, passing the `facility` prop to each

### 3. Fix mobile "Visa" for alarms

In `BuildingInsightsView`, the alarm "Visa i 3D" handler on mobile currently does `navigate('/viewer?...')` which loses the color event. Instead, store the alarm visualization payload in `sessionStorage` before navigating so the viewer can read it on mount (this pattern is already used for `insights_color_map`). Ensure the `ALARM_ANNOTATIONS_SHOW_EVENT` data is also persisted similarly.

**Files to edit:**
- `src/components/insights/tabs/PredictiveMaintenanceTab.tsx`
- `src/components/insights/tabs/RoomOptimizationTab.tsx`
- `src/components/insights/tabs/RagSearchTab.tsx`
- `src/components/insights/BuildingInsightsView.tsx`

