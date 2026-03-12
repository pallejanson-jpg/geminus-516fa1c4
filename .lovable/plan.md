

# Plan: Carry Floor Selection from Portfolio/Navigator to Viewer

## Problem
When navigating from Portfolio or Navigator with a specific floor selected (e.g. `?floor=xxx`), the `UnifiedViewer` dispatches a `FLOOR_SELECTION_CHANGED_EVENT` with `visibleFloorFmGuids: [floorFmGuid]`. However, the `FloatingFloorSwitcher` handler (lines 78-100) only checks `visibleMetaFloorIds`, `floorId`, and `isAllFloorsVisible` — it completely ignores `visibleFloorFmGuids`. This means the floor pills never update to show the selected floor, and the 3D view doesn't isolate the correct floor.

## Fix

**File: `src/components/viewer/FloatingFloorSwitcher.tsx` (lines 78-100)**

Add a branch in the external event handler to match `visibleFloorFmGuids` against each floor's `databaseLevelFmGuids`:

```typescript
// After the isAllFloorsVisible check and visibleMetaFloorIds check:
} else if (e.detail.visibleFloorFmGuids?.length > 0) {
  const matching = floors
    .filter(f => f.databaseLevelFmGuids.some(g =>
      e.detail.visibleFloorFmGuids!.some(vg => vg.toLowerCase() === g.toLowerCase())
    ))
    .map(f => f.id);
  if (matching.length > 0) setVisibleFloorIds(new Set(matching));
}
```

This ensures that when the event carries database-level FMGUIDs (as sent by Portfolio/Navigator navigation), the floor switcher correctly identifies and isolates the matching floor.

**Same fix needed in `FloorVisibilitySelector.tsx`** — its external event handler (around line 130-139) has the same gap. Add the same `visibleFloorFmGuids` matching logic there.

No other files need changes. The event dispatch in `UnifiedViewer.tsx` already sends the correct data — only the receivers need to handle it.

