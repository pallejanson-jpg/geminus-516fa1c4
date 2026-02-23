

## Fix: Asset+ Categories Instead of IFC Types + Performance Improvements

### Problem 1: Wrong Categories
The Categories section currently scans the xeokit `metaScene` for raw IFC types (`IfcDoor`, `IfcWindow`, `IfcWall`, etc.). Per previous agreement, it should show **Asset+ categories** from the database: `Instance`, `Space`, `Building Storey`, `Building`, `Complex`.

The database confirms these are the only Asset+ categories available (Instance: 144k, Space: 3187, Building Storey: 67, Building: 14, Complex: 1).

### Fix
Replace the `metaScene` IFC-type scanning (lines 200-230) with a simple `useMemo` that counts categories from `buildingData` (already loaded from Asset+). This also eliminates the polling interval (`setInterval`) that retries up to 15 times waiting for metaScene -- a performance win.

The `categoryToIfcTypes` mapping (lines 378-401) stays, since it's needed to translate Asset+ categories to IFC types for the 3D filter logic.

### Problem 2: Performance
Several performance issues identified:

1. **Category polling**: The `setInterval` retry loop (up to 15x at 500ms) scanning all metaObjects is unnecessary if we use Asset+ data directly.
2. **Entity map rebuild**: `buildEntityMap` has `spaces` in its dependency array. Since `spaces` is recomputed when `checkedLevels` changes, the entity map rebuilds on every level toggle -- expensive O(n*m) matching with `find()` on arrays.
3. **`applyFilterVisibility`** calls `scene.setObjectsXRayed(scene.objectIds, true)` on every filter change -- touching every entity in the scene. For large models (100k+ objects) this is slow.

### Fixes
- Remove the `setInterval` category scanner entirely.
- Memoize `buildEntityMap` to only rebuild when `levels` or `spaces` data actually changes (not on checkbox toggles). Remove `spaces` from the rebuild trigger by caching space data separately.
- Add a `requestAnimationFrame` wrapper around `applyFilterVisibility` to debounce rapid checkbox toggles.

### Technical Changes

**File: `src/components/viewer/ViewerFilterPanel.tsx`**

| Lines | Change |
|---|---|
| 200-230 | Replace IFC metaScene scanner with `useMemo` counting `buildingData` categories |
| 360-374 | Remove `spaces` from `buildEntityMap` dependency; build space map only once when panel opens |
| 405-551 | Wrap `applyFilterVisibility` body in `requestAnimationFrame`; skip redundant resets if state hasn't changed |

No other files need changes.
