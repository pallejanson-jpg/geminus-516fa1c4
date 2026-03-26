

# Fix: Color Filter Early Return Skips nameColorMap Fallback

## Problem

`RoomVisualizationPanel` sends three maps in the color event: `colorMap`, `nameColorMap`, and `entityColorMap`. In `NativeXeokitViewer` (line 1316-1328), if `entityColorMap` has **any** entries, it applies those and **returns early** — skipping the GUID + name-based fallback entirely. This means if `entityIdCache` resolves even one room, all other rooms that need name-based matching are never colored.

The Insights panel works because it does NOT send `entityColorMap`, so the handler always reaches the `nameColorMap` fallback path.

## Fix

**File: `src/components/viewer/NativeXeokitViewer.tsx`**

Remove the early `return` at line 1328. Instead, after applying `entityColorMap` entries, let the code fall through to the GUID + name matching loop. In that loop, skip entities that were already colored by `entityColorMap` (to avoid double-processing).

Specifically:
1. Apply `entityColorMap` entries (keep lines 1316-1327)
2. Remove the `return;` at line 1328
3. Track which entity IDs were already colored: `const alreadyColored = new Set(Object.keys(entityColorMap))`
4. In the `metaObjects` loop (line 1362), add an early skip: `if (alreadyColored.has(mo.id)) return;`

This way entityColorMap is used first (direct hit), but unmatched rooms still get the nameColorMap fallback — matching the Insights behavior.

## Technical Details

| File | Change |
|------|--------|
| `NativeXeokitViewer.tsx` | Remove early return after entityColorMap, add skip-set for already-colored entities |

