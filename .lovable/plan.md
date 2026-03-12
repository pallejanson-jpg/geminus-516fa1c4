

# Plan: Unify Room Layout — Use Insights Grid Style in Portfolio Storey Page

## What Changes

Replace the single-column row layout in `FacilityLandingPage.tsx` (storey room list, lines 797-853) with the same multi-column compact card grid used in `BuildingInsightsView.tsx` (lines 1043-1094).

## File: `src/components/portfolio/FacilityLandingPage.tsx`

**Replace lines 797-853** (the `space-y-1` room rows) with a grid layout matching Insights:

```
grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1.5
```

Each room card becomes a compact centered tile showing:
- Room name (truncated, 10px muted text)
- Area value as the bold center number (like sensor values in Insights)
- Room