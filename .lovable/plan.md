

# Viewer Fixes Plan

## Issues to Address

1. **2D plan in split view too faint** — needs Dalux-style bold walls, high contrast
2. **3D should reset camera when entering 2D/3D split**
3. **Color filter (RoomVisualizationPanel) not working** — dispatches `INSIGHTS_COLOR_UPDATE_EVENT` but rooms never colorize because `fmGuidLookup` keys don't match xeokit `originalSystemId` values
4. **Filter menu destroys theme colors** — `applyFilterVisibility` clears colorize when filters exist, doesn't re-apply theme
5. **Filter checkboxes should be single-select** (Ctrl+click for multi) — all four sections
6. **Sources should list ALL BIM models**, not just A-models

---

## 1. Bold 2D Plan (SplitPlanView)

**File:** `src/components/viewer/SplitPlanView.tsx`

- Increase wall edge width from 8 to **12** in monochrome mode
- Darken wall colorize to `[0.0, 0.0, 0.0]` (pure black)
- Make spaces brighter: change from `[1, 1, 1]` opacity 0.6 to `[0.95, 0.95, 0.95]` opacity **0.9** for more visible room fills
- Increase door/window opacity from 0.5 to 0.7
- Set background of the 2D container to **white** so the plan reads clearly against a clean backdrop

## 2. Reset 3D Camera on Split Entry

**File:** `src/pages/UnifiedViewer.tsx`

- In the `useEffect` for `viewMode === 'split2d3d'`, after setting first-person mode, call `viewer.cameraFlight.flyTo({ aabb: viewer.scene.aabb, duration: 0.3 })` to reset to full building overview
- This ensures the 3D pane starts with a known good camera position instead of whatever the user left it at

## 3. Fix Color Filter (Spaces Not Colorized)

**Root cause:** `RoomVisualizationPanel` dispatches `colorMap` keyed by Asset+ `fmGuid` values. `NativeXeokitViewer`'s `INSIGHTS_COLOR_UPDATE` handler iterates `metaScene.metaObjects` and normalizes `originalSystemId` to match. But for many buildings, the Asset+ fmGuid and xeokit originalSystemId are different GUIDs. The name-based fallback (`nameColorMap`) works in Insights but is suppressed when `strictGuidMode` is set.

**Fix in `src/components/viewer/NativeXeokitViewer.tsx`:**

- In the `INSIGHTS_COLOR_UPDATE` handler for `room_spaces` mode, add a second pass: build a reverse lookup from xeokit IfcSpace `originalSystemId`/`id` → entity, then for each `fmGuid` in `colorMap`, check the `geometry_entity_map` table's cached data or scan `propertySets` for matching FM GUID properties
- Simpler approach: use the **entity ID cache** strategy already in `RoomVisualizationPanel` — for each room fmGuid in colorMap, look up matching xeokit entity IDs via the same multi-strategy resolution (originalSystemId, externalId, propertySets scan, name match) and colorize those entities directly
- Specifically: move the entity resolution logic into a shared utility, or have `RoomVisualizationPanel` send `entityColorMap: Record<entityId, rgb>` alongside `colorMap` in the event detail, so `NativeXeokitViewer` can skip the GUID-matching entirely

**Chosen approach:** Have `RoomVisualizationPanel.applyVisualization()` also include an `entityColorMap` keyed by xeokit entity IDs (from `entityIdCache`) in the `INSIGHTS_COLOR_UPDATE_EVENT` detail. Then in `NativeXeokitViewer`, if `entityColorMap` is provided, use it directly instead of the fmGuid matching loop.

**Files:**
- `src/components/viewer/RoomVisualizationPanel.tsx` — add `entityColorMap` to the dispatched event
- `src/lib/viewer-events.ts` — extend `InsightsColorUpdateDetail` with optional `entityColorMap`
- `src/components/viewer/NativeXeokitViewer.tsx` — in the handler, check for `entityColorMap` first

## 4. Filter Menu Theme Preservation

**File:** `src/components/viewer/ViewerFilterPanel.tsx`

- In `applyFilterVisibility`, after the filter logic completes (end of the rAF callback), re-apply the active theme if `activeThemeIdRef.current` is set, similar to the cleanup effect
- Currently the filter reset logic at line ~996 clears colorize when filters are active and theme is NOT active — but after clearing, it never reapplies the theme. Add: after the visibility delta update and before `isApplyingRef.current = false`, dispatch `VIEWER_THEME_REQUESTED_EVENT` if a theme is active
- Also in the "Reset colors" button handler (line ~1984), after dispatching `INSIGHTS_COLOR_RESET`, re-request the active theme

## 5. Single-Select Checkboxes (Ctrl for Multi)

**File:** `src/components/viewer/ViewerFilterPanel.tsx`

- Modify `FilterRow` to pass the native click event to `onCheckedChange`
- Change `FilterRowProps.onCheckedChange` signature to `(checked: boolean, event?: React.MouseEvent) => void`
- In `FilterRow`, capture the click event on the Checkbox and pass it through
- Modify all four toggle handlers (`handleSourceToggle`, `handleLevelToggle`, `handleSpaceToggle`, `handleCategoryToggle`) to accept an optional event parameter:
  - If `checked` is true and `event?.ctrlKey` is false (or event is undefined), replace the Set with a single-item Set
  - If `checked` is true and `event?.ctrlKey` is true, add to existing Set (current behavior)
  - If `checked` is false, remove from Set (current behavior)

## 6. Show All BIM Models in Sources

**File:** `src/components/viewer/ViewerFilterPanel.tsx`

- In the `sources` useMemo (line ~367), remove the `isAModelName` filter
- Include all models from `storeyAssets` that have a valid sourceName (not a GUID)
- This will list B-modell, E-modell, V-modell etc. alongside A-modell
- Keep the `isArchitecturalModel` check in the fallback path (`sourceMap.size === 0`) to avoid showing unnamed/orphan models, but otherwise show all disciplines

---

## Technical Summary

| # | File(s) | Change |
|---|---------|--------|
| 1 | `SplitPlanView.tsx` | Bolder walls, brighter spaces, white bg |
| 2 | `UnifiedViewer.tsx` | Reset camera on split2d3d entry |
| 3 | `RoomVisualizationPanel.tsx`, `viewer-events.ts`, `NativeXeokitViewer.tsx` | Pass entityColorMap in event for direct coloring |
| 4 | `ViewerFilterPanel.tsx` | Re-apply theme after filter visibility updates |
| 5 | `ViewerFilterPanel.tsx` | Single-select default, Ctrl for multi |
| 6 | `ViewerFilterPanel.tsx` | Remove A-model-only filter on Sources |

