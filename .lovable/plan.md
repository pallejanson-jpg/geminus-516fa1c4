

# Fix Filter Menu & Colorization — A-Model Spaces Only

## Problem

The ViewerFilterPanel and RoomVisualizationPanel don't filter spaces to A-model storeys only. This causes:
- Wrong room counts (e.g., 4 instead of 64 for Centralstationen Plan A-00)
- Sources showing all models instead of only A/a-models
- Colorization only hitting the few spaces that happen to match xeokit geometry from non-A models

## Root Cause

`AppContext.buildNavigatorTree` correctly filters to A-model spaces, but `ViewerFilterPanel` and `RoomVisualizationPanel` independently read from `allData` without applying the same filter.

## Changes

### 1. `src/lib/building-utils.ts` — Export shared `isAModelName` helper

Extract the A-model detection logic (currently duplicated in AppContext and FacilityLandingPage) into a shared exported function so all components use the same logic.

```ts
export const isAModelName = (name: string | null | undefined): boolean => {
  if (!name) return false;
  const upper = name.toUpperCase().trim();
  if (upper.includes('ARKITEKT') || upper.includes('A-MODELL') || ...) return true;
  if (upper.charAt(0) === 'A' && ...) return true;
  return false;
};
```

Also add a helper to get A-model storey GUIDs from allData for a building:

```ts
export const getAModelStoreyGuids = (allData: any[], buildingFmGuid: string): Set<string> => { ... };
```

### 2. `src/components/viewer/ViewerFilterPanel.tsx`

**`storeyAssets` memo (line 200):** No change needed — already computes `sourceName`.

**`levels` memo (line 239):** When computing `spaceCount` for each level, filter `buildingData` spaces to only those whose `levelFmGuid` belongs to an A-model storey. Add a memoized `aModelStoreyGuids` set derived from `storeyAssets` using `isAModelName(storey.sourceName)`.

**`sources` memo (line 332):** Instead of showing all `sharedModels`, filter to only show sources that have A-model storeys. Use `sourceNameLookup` and `isAModelName` to determine which source GUIDs are A-models.

**`spaces` memo (line 364):** The `aModelLevelGuids` set is built from `levels` — but `levels` currently includes non-A-model named storeys. Fix: build a separate `aModelSpaceLevelGuids` set from `storeyAssets` where `isAModelName(sourceName)`, and use that to filter `allSpaces`.

**`buildEntityMap` (line 727):** The `allAssetSpaces` should also be filtered to A-model spaces only, so the entity map only maps A-model rooms to xeokit IDs.

### 3. `src/components/viewer/RoomVisualizationPanel.tsx`

**`filteredRooms` memo (line 258):** Add A-model filtering:
- From `allData`, find all "Building Storey" assets for the building
- Identify which are A-model using `isAModelName(parentCommonName)`
- Build a set of A-model storey GUIDs
- Filter `roomData` to only include spaces whose `levelFmGuid` is in the A-model storey set

This will bring the colorized room count from ~4 to the correct ~64.

### 4. Update imports in `AppContext.tsx` and `FacilityLandingPage.tsx`

Replace inline `isAModelName` definitions with imports from `building-utils.ts` to ensure consistency and reduce duplication.

### Files to modify

| File | Change |
|------|--------|
| `src/lib/building-utils.ts` | Add exported `isAModelName` and `getAModelStoreyGuids` helpers |
| `src/components/viewer/ViewerFilterPanel.tsx` | Filter sources to A-models; filter spaces to A-model storeys; filter space counts in levels |
| `src/components/viewer/RoomVisualizationPanel.tsx` | Filter `filteredRooms` to A-model spaces only |
| `src/context/AppContext.tsx` | Import shared `isAModelName` instead of inline definition |
| `src/components/portfolio/FacilityLandingPage.tsx` | Import shared `isAModelName` instead of inline definition |

### Expected outcome

- **Sources**: Only A-model sources shown (e.g., "A-modell mot Klarabergsviadukten", "A-modell mot Vasagatan", etc.)
- **Levels**: Correct space counts reflecting only A-model rooms
- **Spaces**: Only A-model spaces listed and filtered
- **Colorization**: All A-model rooms on the selected floor get colored (64 for Plan A-00)
- **Categories/Modifications/Annotations**: Scoped by xeokit scene objects (all models), filtered by active source/level/space selection

