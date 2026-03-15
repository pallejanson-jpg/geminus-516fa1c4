

## Problem Analysis

There are **6+ different area calculation implementations** scattered across the codebase, each with slightly different logic and fallback chains:

| File | Method | Handles NTA object? | Handles NTA number? | Handles grossArea? |
|------|--------|---------------------|---------------------|--------------------|
| `building-utils.ts` (`extractNtaFromAttributes`) | NTA `{value: N}` only | ✅ | ❌ | ❌ |
| `PortfolioView.tsx` | Uses `extractNtaFromAttributes` | ✅ | ❌ | ❌ |
| `HomeLanding.tsx` / `HomeLandingV2.tsx` | Uses `extractNtaFromAttributes` | ✅ | ❌ | ❌ |
| `FacilityLandingPage.tsx` | Inline logic | ✅ | ✅ (via Number()) | ✅ (`grossArea`/`gross_area`) |
| `BuildingInsightsView.tsx` | Inline logic | ✅ | ✅ | ✅ (`grossArea`) |
| `PerformanceTab.tsx` | Inline logic | ✅ | ✅ | ✅ |
| `SpaceManagementTab.tsx` | Inline logic | ✅ | ✅ | ✅ |
| `PortfolioManagementTab.tsx` | Inline logic | ✅ | ✅ | ✅ |
| `BuildingSelector.tsx` | Custom loop | ✅ | ❌ | ❌ |

The root `extractNtaFromAttributes` function only handles the `{value: number}` shape — it **misses** direct number NTA values and `grossArea` fallbacks. This means PortfolioView, HomeLanding, and BuildingSelector show 0 m² for spaces that store area differently.

## Plan

### 1. Enhance `extractNtaFromAttributes` in `src/lib/building-utils.ts`

Add a single robust function `extractSpaceArea(space)` that consolidates **all** fallback chains:
1. NTA attribute as `{value: number}`
2. NTA attribute as direct number
3. `grossArea` property
4. `gross_area` property  
5. `attributes.area` property

Keep the existing `extractNtaFromAttributes` for backward compat but have it also handle direct numbers.

### 2. Replace inline area logic in all consumers (8 files)

- `src/components/portfolio/PortfolioView.tsx` — use `extractSpaceArea`
- `src/components/home/HomeLanding.tsx` — use `extractSpaceArea`
- `src/pages/HomeLandingV2.tsx` — use `extractSpaceArea`
- `src/components/portfolio/FacilityLandingPage.tsx` — replace inline logic with `extractSpaceArea`
- `src/components/insights/BuildingInsightsView.tsx` — replace inline logic
- `src/components/insights/tabs/PerformanceTab.tsx` — replace inline logic
- `src/components/insights/tabs/SpaceManagementTab.tsx` — replace inline logic
- `src/components/insights/tabs/PortfolioManagementTab.tsx` — replace inline logic
- `src/components/viewer/BuildingSelector.tsx` — replace custom loop

All files will import from `@/lib/building-utils`, ensuring one source of truth for area extraction across both mobile and desktop views.

