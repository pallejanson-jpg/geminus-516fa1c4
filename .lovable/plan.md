

# Fix Filter Menu Sources, Spaces & Annotations

## Status: IN PROGRESS (updating previous plan)

## Three remaining bugs

### Bug 1: Sources & Spaces — GUID domain mismatch (from previous diagnosis)
The `levels` memo matches `sharedFloors[].databaseLevelFmGuids` (xeokit IFC GlobalIds) against `storeyAssets[].normalizedFmGuid` (Asset+ FM GUIDs). These are different identifier systems, so most levels get `sourceGuid = ''` → collapse to "Orphan". The `spaces` memo then uses `levels[].allGuids` which contains the wrong GUID domain, so space `levelFmGuid` doesn't match → only 4 spaces instead of 64.

**Fix in `ViewerFilterPanel.tsx`:**
- In `levels` memo: also try **name-based matching** between `sharedFloors` and `storeyAssets` (case-insensitive). When matched, add the Asset+ FM GUID to the level's `allGuids`.
- Build `aModelLevelGuids` from `storeyAssets` directly (Asset+ FM GUIDs via `getAModelStoreyGuids`) instead of from `levels[].allGuids`.
- `spaces` filter uses this Asset+ GUID set so `space.levelFmGuid` matches correctly.

### Bug 2: Annotations — only one category shows at a time
**Root cause:** `NativeXeokitViewer` TOGGLE_ANNOTATIONS handler (line 1631-1755) has a fatal flow:
1. First category checked → `markerContainer` is null → creates markers **only for that category** (filtered by `visibleCategories`)
2. Second category checked → `markerContainer` exists with children → handler enters the "filter existing markers" branch (line 1646) → but markers for the new category were **never created**

**Fix in `NativeXeokitViewer.tsx`:**
- When TOGGLE_ANNOTATIONS fires with `show: true`, **always fetch and create ALL annotation markers** (unfiltered), then apply `visibleCategories` as a display filter on the created markers.
- Remove the `if (markerContainer.children.length > 0) return;` early-exit that prevents re-creation.

### Bug 3: Annotation filter query mismatch
**Root cause:** Filter panel (line 873) queries `created_in_model.eq.false,asset_type.eq.IfcAlarm` but NativeXeokitViewer (line 1668) queries `annotation_placed.eq.true,created_in_model.eq.false`. They should use the same criteria.

**Fix:** Align both queries to `annotation_placed.eq.true,created_in_model.eq.false` so the filter panel shows the same categories the viewer can display.

## Files to modify

| File | Change |
|------|--------|
| `src/components/viewer/ViewerFilterPanel.tsx` | Name-based storey matching in levels; Asset+ GUID-based space filtering; fix annotation query |
| `src/components/viewer/NativeXeokitViewer.tsx` | Always create all markers, then filter by category visibility |
| `src/components/viewer/RoomVisualizationPanel.tsx` | Verify A-model filtering uses Asset+ GUIDs (may already be correct) |

## Expected outcome
- **Sources**: "A-modell mot Klarabergsviadukten", "A-modell mot Vasagatan", "A-modell mot Vasagatan Källarplan", "Orphan"
- **Levels**: Correct space counts (64 for Plan A-00)
- **Spaces**: All A-model rooms shown and colored
- **Annotations**: All categories visible when checked, not just fire blankets

