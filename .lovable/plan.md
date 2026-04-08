

# Floor Clipping — Correct Ceiling Cut at Next Floor's Slab Bottom

## Problem
When selecting a single floor (via Floor Switcher or Filter Panel), walls and other objects can extend visually above where the floor above starts. The ceiling SectionPlane should clip at the **bottom of the next floor's slab**, not at `nextFloor.minY + 0.05` (which is the bounding box minimum of all entities on that storey — potentially lower than the slab).

Additionally, the Filter Panel emits `skipClipping: true`, meaning **no clipping is applied at all** when filtering floors from the filter menu.

## Root Cause

1. **`calculateClipHeightFromFloorBoundary`** in `useSectionPlaneClipping.ts` uses `nextFloor.minY` — the overall AABB minimum of all children of the next storey. This includes furniture legs, pipes below the slab, etc. The correct reference point is the **bottom of the IfcSlab entities** belonging to the next storey.

2. **FilterPanel sends `skipClipping: true`** — the ViewerToolbar ignores clipping entirely when this flag is set. The FilterPanel should NOT skip clipping when a solo floor is selected.

## Solution

### Step 1: Find the slab bottom of the next floor (useSectionPlaneClipping.ts)

Replace the naive `nextFloor.minY` with a dedicated slab-bottom calculation:

- For the **next storey**, collect all child entities whose `metaObject.type` matches slab types (`IfcSlab`, `IfcSlabStandardCase`, `IfcSlabElementedCase`, `IfcPlate`).
- Find the **minimum Y of the AABB** of those slab entities — this is the underside of the floor deck above.
- If no slabs are found on the next storey, fall back to `nextFloor.minY` (current behavior).
- Set `clipHeight = slabBottomY - 0.02` (small inset so the slab itself is just hidden, giving a clean cut).

```text
Current floor:  ┌─────────────┐
  walls extend  │    WALL      │
  too high ───> │             │
                │             │
Next floor slab:├═════════════╡  ← clip HERE (slab AABB minY)
                │  next floor │
```

### Step 2: Remove skipClipping from FilterPanel solo-floor events (ViewerFilterPanel.tsx)

When the FilterPanel resolves to exactly 1 visible floor (`isSoloFloor: true`), emit the event **without** `skipClipping: true` so the ViewerToolbar applies ceiling clipping.

Change the emit around line 1580:
```
skipClipping: visibleFmGuids.length !== 1,  // only skip when NOT solo
```

### Step 3: Also apply clipping from "Show All" → single floor in FilterPanel (ViewerFilterPanel.tsx)

When going from "show all sources" to unchecking sources until one floor remains, ensure the same solo-floor clipping logic triggers.

## Files to Edit

1. **`src/hooks/useSectionPlaneClipping.ts`** — Rewrite `calculateClipHeightFromFloorBoundary` to find slab entities on the next storey and use their AABB `minY` as the clip height.

2. **`src/components/viewer/ViewerFilterPanel.tsx`** (~line 1587) — Change `skipClipping` to be conditional: `false` when solo floor, `true` otherwise.

## Technical Detail

xeokit `SectionPlane` with `dir: [0, 1, 0]` discards everything **above** `pos[1]`. By setting `pos[1]` to the slab bottom of the floor above (minus a tiny epsilon), walls on the current floor are cleanly cut where the ceiling/slab begins, which is the physically correct boundary.

