

## Plan: Position Picker Fixes + Local-Only Save Policy

Three changes based on your additions.

---

### 1. Local-only save — no Asset+ sync during inventory

**Files:** `QuickRegistrationStep.tsx`, `InventoryForm.tsx`, `ExcelImportDialog.tsx`

Current `QuickRegistrationStep` already saves directly to Supabase `assets` table with `is_local: true` — this is correct. Verify `InventoryForm.tsx` does the same (it does). For `ExcelImportDialog`, it currently calls the `asset-plus-create` edge function — change it to insert directly into the local `assets` table with `is_local: true` instead. No sync to Asset+ or FM Access during creation/editing.

---

### 2. Fix PositionPickerDialog — use buildingFmGuid + fly-to room

**Files:** `PositionPickerDialog.tsx`, `Inline3dPositionPicker.tsx`

**Bug fix:** Both files set `targetFmGuid = roomFmGuid || buildingFmGuid` and pass it as `buildingFmGuid` to `NativeXeokitViewer`. XKT models are indexed by building GUID, so this fails when a room is selected.

**Fix:**
- Always pass `buildingFmGuid` to `NativeXeokitViewer`
- When viewer is ready AND `roomFmGuid` is provided: look up the room's entity in the viewer scene (by matching entity IDs containing the room GUID), then call `viewer.cameraFlight.flyTo({ aabb: entity.aabb })` to fly to that room
- This gives the user immediate spatial context of where they're placing

---

### 3. Single-click pick instead of long-press/double-click

**Files:** `PositionPickerDialog.tsx`, `Inline3dPositionPicker.tsx`

Current behavior uses long-press (500ms) on mobile and double-click on desktop. The user wants simple single-click pick like in other parts of the system.

**Change:**
- Replace long-press and double-click handlers with a single `click` event listener on the canvas
- On click → `viewer.scene.pick({ canvasPos, pickSurface: true })` → set pending coords
- This matches the pattern used elsewhere and avoids conflicts with the Select tool

**2D height warning:**
- After picking, if the viewer is in orthographic/2D mode (check `viewer.camera.projection === 'ortho'`), show a toast or inline banner: "Position picked in 2D — height may not be accurate. Switch to 3D for precise height." with an optional action button.

---

### Summary of file changes

| File | Change |
|---|---|
| `PositionPickerDialog.tsx` | Use `buildingFmGuid` for viewer, fly-to `roomFmGuid`, single-click pick, 2D height warning |
| `Inline3dPositionPicker.tsx` | Same: use `buildingFmGuid` for viewer, fly-to room, single-click pick |
| `ExcelImportDialog.tsx` | Save locally to `assets` table instead of calling `asset-plus-create` edge function |

