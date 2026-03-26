

# Fix 7 Viewer Issues

## Issues Summary

1. **Space color filter not colorizing** — ObjectColorFilterPanel applies colors but they get immediately wiped by theme re-application
2. **Theme color switching/flashing** — Filter panel cleanup + re-apply cycles cause visible theme toggling  
3. **Annotations all on same position** — Annotations with coordinate (0,0,0) aren't placed at room center; all stack at origin
4. **Annotation category filter broken** — All categories show regardless of selection; `catSet` filter only hides via CSS `display:none` but `updatePos` overwrites it back to `display:block`
5. **X-ray objects still clickable/affecting zoom** — xrayed entities remain `pickable=true`, so they intercept picks and affect camera zoom fitting
6. **2D Reset View jumps to 3D** — `handleResetView` restores 3D perspective camera regardless of current view mode
7. **Right-click pan conflicts with context menu** — `contextmenu` event fires on right-click, blocking xeokit's native right-click-to-pan

## Changes

### 1. ObjectColorFilterPanel — space coloring fix
**File: `src/components/viewer/ObjectColorFilterPanel.tsx`**

The `applyRules` function resets all colorize to `null`, then applies rule colors. But immediately after, the ViewerFilterPanel's `applyFilterVisibility` fires (via `VIEWER_THEME_REQUESTED_EVENT`) and overwrites everything.

Fix: After applying color rules successfully, set `(window as any).__colorFilterActive = true` (already done) AND dispatch `VIEWER_THEME_CHANGED_EVENT` to suppress subsequent theme re-application. Also, in `applyRules`, after coloring spaces, make matched IfcSpace entities `visible=true` and `pickable=true` so they actually show.

The real issue is that `applyRules` colors objects by their `metaObj.id` but spaces are hidden (`visible=false`) by default. When a rule matches an IfcSpace, the color is applied but the entity stays invisible. Fix: after colorizing, if the entity's type is IfcSpace, also set `entity.visible = true`.

### 2. Theme flashing fix
**File: `src/components/viewer/ViewerFilterPanel.tsx`**

In `applyFilterVisibility` (line ~971-990), the cleanup at the top resets colorize then the bottom (line 1531) dispatches `VIEWER_THEME_REQUESTED_EVENT`. This creates a visible flash: native colors → theme colors.

Fix: Skip the full colorize reset when a theme is active (already partially done on line 978-990). Additionally, when `__colorFilterActive` is true, skip the theme re-application dispatch at line 1531. The color filter should take precedence over the theme.

In the cleanup effect (line 1628-1682), when `!isVisible`: don't clear colorize if `__colorFilterActive` is true.

### 3. Annotation positions — default to room center
**File: `src/components/viewer/NativeXeokitViewer.tsx`**

In the TOGGLE_ANNOTATIONS handler (line 1720-1733), when `coordinate_x/y/z` are all 0 (no position set), find the room the annotation belongs to and use the room's AABB center as the world position.

Fix: Before computing `worldPos`, check if coordinates are all zero/null. If so:
- Look up the annotation's room assignment from the database (via `level_fm_guid` or `parent` relationship)  
- Or fall back: find the IfcSpace entity in the scene that matches the annotation's space, use its AABB center
- If no match, skip marker (don't show at origin)

### 4. Annotation category filter — visibility conflict
**File: `src/components/viewer/NativeXeokitViewer.tsx`**

The `updatePos` function (line 1720) sets `marker.style.display = 'block'` when the position is valid, overriding the `display: 'none'` set by the category filter (line 1714-1716).

Fix: Store the category visibility as a data attribute (`marker.dataset.hidden = 'true'`) and check it in `updatePos`:
```
if (canvasPos && canvasPos[2] > 0 && marker.dataset.hidden !== 'true') {
  marker.style.display = 'block';
  ...
}
```

### 5. X-ray — make xrayed objects unpickable
**Files: `src/components/viewer/XrayToggle.tsx`, `src/components/viewer/ViewerToolbar.tsx`, `src/components/viewer/ViewerFilterPanel.tsx`**

When xray is enabled, set `entity.pickable = false` on xrayed entities. When disabled, restore `pickable = true`.

In ViewerFilterPanel's space-xray code (line 1306-1325, 1453-1468): after `scene.setObjectsXRayed(nonSolidIds, true)`, also set `scene.setObjectsPickable(nonSolidIds, false)`. For the solid room objects, ensure `pickable = true`.

In XrayToggle: add `entity.pickable = false` when xraying, `entity.pickable = true` when un-xraying.

In ViewerToolbar handleXrayToggle: same pattern.

### 6. Reset View respects 2D mode
**File: `src/components/viewer/ViewerToolbar.tsx`**

In `handleResetView` (line 435): check `viewModeRef.current`. If `'2d'`, instead of flying to initial 3D camera + removing clipping, re-apply 2D mode (call `handleViewModeChange('2d')` or at minimum keep ortho/planView and just re-center the 2D view).

### 7. Right-click pan vs context menu
**File: `src/components/viewer/NativeViewerShell.tsx`**

The `contextmenu` event handler (line 718) fires on every right-click, blocking xeokit's native right-click-to-pan. 

Fix: Only show context menu on right-click if the click is a "stationary" click (no mouse movement between mousedown and mouseup). Track mouse position on `mousedown` for right button, then in `contextmenu` handler, check if mouse moved > 5px — if so, suppress the context menu and let xeokit handle pan.

## Split 2D/3D improvements

### 8. Split mode — auto-select floor + first person
**File: `src/pages/UnifiedViewer.tsx`**

When entering `split2d3d` mode (line 98-116): instead of dispatching `isAllFloorsVisible: true`, auto-select the first floor and set camera to first-person at floor height.

Fix:
- When entering split2d3d, find the first/current floor from the viewer
- Dispatch `FLOOR_SELECTION_CHANGED_EVENT` with that floor selected
- Set `navMode = 'firstPerson'` on the 3D camera
- Set `constrainVertical = true` to prevent leaving the floor plane

### 9. Split mode — lock Y movement
**File: `src/pages/UnifiedViewer.tsx`**

In split2d3d mode, add a camera listener that clamps the eye Y position to the selected floor's height range, preventing vertical pan/drift.

### 10. 2D plan wall/floor styling
**File: `src/components/viewer/SplitPlanView.tsx`**

In the monochrome styling section (line 472-530):
- Walls: use darker color (currently `[0.1, 0.1, 0.1]` — already dark, but ensure `edgeWidth` is higher for split mode)
- Spaces/floors: use white (`[1, 1, 1]`) instead of current `[0.92, 0.92, 0.92]`

## Files to modify

| File | Changes |
|------|---------|
| `src/components/viewer/ObjectColorFilterPanel.tsx` | Make matched IfcSpace entities visible when colored |
| `src/components/viewer/ViewerFilterPanel.tsx` | Skip theme re-apply when color filter active; skip colorize reset when color filter active; make xrayed objects unpickable |
| `src/components/viewer/NativeXeokitViewer.tsx` | Fix annotation position (room center fallback); fix category visibility in updatePos |
| `src/components/viewer/XrayToggle.tsx` | Set pickable=false on xrayed entities |
| `src/components/viewer/ViewerToolbar.tsx` | Reset view respects 2D mode; xray sets pickable=false |
| `src/components/viewer/NativeViewerShell.tsx` | Right-click: only show context menu on stationary click, not on pan drag |
| `src/pages/UnifiedViewer.tsx` | Split mode: auto-select floor + first person; clamp Y to floor |
| `src/components/viewer/SplitPlanView.tsx` | White floors, bolder walls in split/monochrome mode |

