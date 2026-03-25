

# Fix Småviken Floor Structure — Exclude Model Storeys, Redistribute A-Model Spaces

## Problem

Småviken's Asset+ data has storeys grouped by BIM model discipline (A-modell, B-modell, E-modell, V-modell) rather than physical floors. The A-model storeys have **no `common_name`**, causing "A-modell" / "Floor 1" / "Plan 1" to appear across Navigator, Portfolio, and Viewer. Meanwhile, correctly named storeys (01, 04-01, FLÄKTRUM-01, etc.) exist under E-modell and V-modell.

**User requirement**: Only A-model **spaces** should be shown. Named storeys (from any model) provide the structural backbone. A-model spaces must be redistributed to matching named storeys.

## Changes

### 1. `src/context/AppContext.tsx` — `buildNavigatorTree`

**Storey filtering (line ~443):** After building the storey map, identify and exclude storeys that are BIM model placeholders:
- Storey has no `common_name` AND no `name`
- AND `parentCommonName` matches a model pattern (A-modell, B-modell, V-modell, E-modell, ARK, etc.)

These excluded storeys' FMGUIDs are tracked in a `modelStoreyGuids` set so their spaces can be redistributed.

**Remove `parentCommonName` from fallback chain (line 449):** Delete `attrs.parentCommonName` from the display name resolution — model names must never appear as floor names.

**Space filtering (line ~502):** Before attaching spaces:
- Build a set of A-model storey GUIDs (storeys where `parentCommonName` matches A/ARK pattern)
- **Only include spaces** whose `level_fm_guid` is in the A-model storey set (or spaces with no model classification)
- Skip spaces belonging to B/E/V-model storeys (they duplicate A-model rooms)

**Space redistribution:** For included A-model spaces whose parent storey was excluded (unnamed), match to a named storey using the room designation prefix:
- Extract prefix from room name (e.g., `01` from `01.3.082` — take characters before the first `.`)
- Match against named storeys whose `common_name` starts with that prefix
- Unmatched spaces fall through to the existing orphan handling

### 2. `src/components/portfolio/FacilityLandingPage.tsx` — `childStoreys`

**Line ~165:** Replace the current A-model preference logic. Instead:
- Keep all storeys that have a `common_name` (regardless of parent model)
- Exclude storeys with no `common_name` (the unnamed A/B-model placeholders)
- This yields the 9+ correctly named storeys

**Line ~196 `childSpaces`:** When filtering spaces for a storey, also match A-model spaces that were redistributed (spaces whose original `levelFmGuid` pointed to an excluded A-model storey, but whose designation prefix matches this storey's name).

### 3. `src/hooks/useFloorData.ts` — DB floor name resolution

**`geometry_entity_map` query (line ~73):** Already skips rows with no `displayName` (`if (!displayName) return`). No change needed.

**`assets` fallback (line ~96):** Already skips entries with no `displayName` (`if (!displayName) return`). No change needed — the filtering happens naturally.

However, the XKT metaScene extraction (the `extractFloors` function) may still create entries for unnamed A-model storeys from the geometry. Add a filter: if a storey from the metaScene has no name in `floorNamesMap` and no name in the metaObject, skip it.

### Files to modify

| File | Change |
|------|--------|
| `src/context/AppContext.tsx` | Exclude unnamed model storeys; remove `parentCommonName` fallback; filter to A-model spaces only; redistribute via designation prefix |
| `src/components/portfolio/FacilityLandingPage.tsx` | Use named storeys (any model) instead of A-model preference; match redistributed spaces |
| `src/hooks/useFloorData.ts` | Skip unnamed storeys in `extractFloors` when they have no DB name |

### Expected outcome

- **Navigator**: Shows 01, 04-01, 05-01, 05-02, 06-01, 06-02, FLÄKTRUM-01, FLÄKTRUM-02, TAKPLAN-02 — no "A-modell" or "B-modell" entries
- **Portfolio**: Same named storeys with correct room counts
- **Viewer floor switcher**: Correct floor names
- **Colorization**: Only A-model spaces colored, grouped under correct named storeys, count matches visible floor

