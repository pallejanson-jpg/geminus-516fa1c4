

## Status: ✅ IMPLEMENTED (v3)

## Changes Made

### 1. ObjectColorFilterPanel — space coloring fix
- After colorizing an IfcSpace entity, set `entity.visible = true` and `entity.pickable = true` so the color actually shows

### 2. ViewerFilterPanel — theme flashing + xray pickable
- Skip colorize reset when `__colorFilterActive` is true
- Skip theme re-application dispatch when color filter is active
- On cleanup: preserve colorize when color filter is active
- X-ray mode: set `pickable=false` on xrayed (non-solid) entities, `pickable=true` on solid entities
- Space-xray (Tandem-style): same pickable logic for xrayed vs solid room objects

### 3. NativeXeokitViewer — annotation fixes
- Fetch `in_room_fm_guid` and `level_fm_guid` in annotation query
- `updatePos`: respect `data-catHidden` attribute — if category is hidden, keep marker hidden
- Position fallback: if coordinates are (0,0,0), look up room entity AABB center; skip marker if no room found
- Category filter: set `marker.dataset.catHidden` flag instead of relying solely on `display:none`

### 4. XrayToggle — pickable fix
- When xraying: `entity.pickable = false`
- When un-xraying: `entity.pickable = true`

### 5. ViewerToolbar — 2D reset view fix
- `handleResetView` checks `viewModeRef.current`; if `'2d'`, re-centers in 2D instead of flying to 3D initial camera
- Also sets `pickable=true` on all entities during reset

### 6. NativeViewerShell — right-click pan fix
- Track `mousedown` position for right button
- In `contextmenu` handler: if mouse moved > 5px since mousedown, suppress context menu (allow xeokit pan)

### 7. UnifiedViewer — split mode auto-floor + first person
- When entering `split2d3d`, dispatch floor selection with current/URL floor
- Set 3D camera to `firstPerson` + `constrainVertical = true`

### 8. SplitPlanView — 2D styling
- Spaces/floors: white (`[1, 1, 1]`) instead of light gray
- Edge width: 8px in monochrome mode for bolder walls
