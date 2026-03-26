

# Fix Filter Menu & Colorization — A-Model Spaces Only

## Status: ✅ IMPLEMENTED

## Changes Made

### 1. `src/lib/building-utils.ts` — Shared helpers
- Exported `isModelName`, `isAModelName`, and `getAModelStoreyGuids`
- Single source of truth for A-model detection across all components

### 2. `src/components/viewer/ViewerFilterPanel.tsx`
- **Sources**: Now shows only A-model sources (from `storeyAssets` with `isAModelName` filter) + Orphan
- **Levels space count**: Filters to A-model spaces only using `getAModelStoreyGuids`
- **Entity map (`buildEntityMap`)**: `allAssetSpaces` now filtered to A-model spaces only

### 3. `src/components/viewer/RoomVisualizationPanel.tsx`
- **`filteredRooms`**: Filters to A-model spaces only using `getAModelStoreyGuids`

### 4. `src/context/AppContext.tsx` & `src/components/portfolio/FacilityLandingPage.tsx`
- Replaced inline `isModelName`/`isAModelName` definitions with imports from `building-utils.ts`

## Expected outcome
- **Sources**: Only A-model sources (e.g., "A-modell mot Klarabergsviadukten", etc.) + Orphan
- **Levels**: Correct space counts reflecting only A-model rooms
- **Spaces**: Only A-model spaces listed and filtered
- **Colorization**: All A-model rooms on the selected floor get colored
