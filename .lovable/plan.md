

# Fix: Filter Menu Levels — Use A-Model Filtering (Same as useFloorData)

## Problem

The Filter menu's level listing uses `parentCommonName` / `parentBimObjectId` attributes from the DB to identify which storeys belong to the A-model. These attributes are often empty or GUID-like, causing the filter to fail and either show all levels or none.

Meanwhile, `useFloorData` (used by FloorVisibilitySelector) successfully filters levels to the A-model using a different approach: it uses `modelNamesMap` (from `useModelNames`) to resolve xeokit scene model IDs to friendly names, then checks which metaObjects belong to A-model objects.

## Solution

Replace the current `aModelSourceGuids` + `storeyAssets.filter()` approach in ViewerFilterPanel with the same logic used by `useFloorData`:

1. Use `modelNamesMap` (already available via `useModelNames` through `useModelData`) to resolve model IDs to friendly names
2. Classify scene models as A-model or not using `isArchitecturalModel(friendlyName)`
3. Build a set of A-model object IDs from the scene
4. Filter the DB storeys by checking if their `fmGuid` (or `normalizedFmGuid`) exists as a metaObject in the A-model's object set

### Changes

**File: `src/components/viewer/ViewerFilterPanel.tsx`**

- Import `useModelNames` hook (or access `modelNamesMap` from existing `useModelData`)
- Replace the `aModelSourceGuids` memo with a new `aModelObjectIds` memo that:
  1. Gets the xeokit viewer's scene models
  2. Uses `modelNamesMap` to resolve each model ID to a friendly name
  3. Checks `isArchitecturalModel(friendlyName)` for each
  4. Collects all object IDs from matching A-models into a Set
- Update the `levels` memo filter: instead of checking `storey.sourceName` / `storey.sourceGuid`, check if the storey's `fmGuid` exists as a metaObject ID in the A-model object set (using `viewer.metaScene.metaObjects`)
- Fallback: if no A-model is identified, show all levels (same as useFloorData)

This aligns the Filter menu, Portfolio, FloorVisibilitySelector, and Navigator to use the same A-model detection logic.

