

# Fix Viewer: Filter Panel, Right-Click, Split View, Performance

## 1. Right-Click Context Menu Suppression
**File:** `src/components/viewer/NativeXeokitViewer.tsx`
- Add `canvas.addEventListener('contextmenu', e => e.preventDefault())` on the xeokit canvas during initialization, preventing the browser menu from appearing during right-click pan.

## 2. Filter Panel — Source Names Never Show GUIDs
**File:** `src/components/viewer/ViewerFilterPanel.tsx` (lines 184-220)
- In the `sources` useMemo, after resolving a name from `apSources`, check if it still looks like a GUID using `isGuid()`. If so, replace with `Modell ${index+1}`.
- Also apply to Strategy 2 fallback names from `sharedModels`.

## 3. Filter Panel — Spaces Drop to 0 When Level Selected (THE BUG)
**Root cause:** The `spaces` useMemo (line 246-250) filters by matching `space.level_fm_guid` against the selected level's GUIDs. If spaces in the database have empty/null `level_fm_guid` (common when hierarchy extraction failed or GUIDs don't match), `filteredByLevel` returns 0 results.

The fallback at lines 253-258 ONLY triggers when `checkedLevels.size === 0` — so when a level IS selected and no spaces match the GUID, the result is 0 spaces.

**Fix (two-pronged):**
1. **Database fallback**: Extend the fallback condition at line 253-258 to also trigger when `filteredByLevel.length === 0 && checkedLevels.size > 0`. In this case, use the **xeokit scene graph** to find spaces: walk the selected level's descendants in `entityMapRef` and collect any `IfcSpace` metaObjects.
2. **Scene-graph matching**: When building `visibleLevelGuids`, also add the xeokit storey's `originalSystemId` (which is what spaces' parent chain references). This bridges the gap between database GUIDs and xeokit's internal IDs.

```typescript
// After filteredByLevel (line 250), replace fallback:
let spacesSource = filteredByLevel;
if (filteredByLevel.length === 0 && allSpaces.length > 0) {
  if (checkedLevels.size === 0) {
    spacesSource = allSpaces; // No filter = show all
  } else {
    // Fallback: find spaces via xeokit scene graph
    const viewer = getXeokitViewer();
    if (viewer?.metaScene?.metaObjects && entityMapRef.current.size > 0) {
      const sceneSpaceGuids = new Set<string>();
      checkedLevels.forEach(levelGuid => {
        const entityIds = entityMapRef.current.get(levelGuid) || [];
        entityIds.forEach(id => {
          const mo = viewer.metaScene.metaObjects[id];
          if (mo?.type === 'IfcSpace') {
            sceneSpaceGuids.add(normalizeGuid(mo.originalSystemId || mo.id));
          }
        });
      });
      if (sceneSpaceGuids.size > 0) {
        spacesSource = allSpaces.filter((a: any) => {
          const fg = normalizeGuid(a.fmGuid || a.fm_guid || '');
          return sceneSpaceGuids.has(fg);
        });
      }
      // If still 0, show all spaces as ultimate fallback
      if (spacesSource.length === 0) spacesSource = allSpaces;
    } else {
      spacesSource = allSpaces;
    }
  }
}
```

## 4. Filter Panel — Categories Filter by Level/Space
Categories already use `entityMapRef` + `scopeIds` (lines 343-356). The issue is the same: if `entityMapRef` doesn't have entries for the checked level GUIDs, `scopeIds` is empty → all categories show unfiltered counts or 0. The entity map fix from step 3 will also fix this since `buildEntityMap` populates `map.set(level.fmGuid, descendants)`.

## 5. Filter Panel — Performance Optimization
**File:** `src/components/viewer/ViewerFilterPanel.tsx`
- Replace the "clean slate" `applyFilterVisibility` with targeted updates:
  - Track previously modified entity IDs in a `ref`
  - Only reset those IDs instead of all scene objects
  - Remove duplicate IfcSpace hiding loops
  - Increase debounce from 150ms → 300ms

## 6. Split View 2D — Sharper Plan (Dalux-style)
**File:** `src/components/viewer/SplitPlanView.tsx`
- Increase `createStoreyMap` resolution to `container.clientWidth * 3` (capped at 4000px)
- Enable `entity.edges = true` with `edgeWidth = 2` for wall entities during map generation
- Add CSS `image-rendering: crisp-edges` to the plan image

## 7. Split View 3D — Dalux-style First-Person Camera
**File:** `src/components/viewer/SplitPlanView.tsx` (handleClick, ~line 798-824)
- Set eye height to `floorY + 1.5` (person-level)
- Look direction: preserve current horizontal heading but force 0° pitch (look straight ahead, not down)
- `nextEye = [worldPos[0], floorY + 1.5, worldPos[2]]`
- `nextLook = [worldPos[0] + dirX*5, floorY + 1.5, worldPos[2] + dirZ*5]`
- Reduce flyTo duration to 0.4s

## Files to Edit
1. `src/components/viewer/NativeXeokitViewer.tsx` — contextmenu suppression
2. `src/components/viewer/ViewerFilterPanel.tsx` — GUID names, spaces fallback, perf optimization
3. `src/components/viewer/SplitPlanView.tsx` — 2D clarity + first-person camera

