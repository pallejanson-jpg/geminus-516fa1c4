

# Fix Plan: Properties Dialog, 2D Floor Filtering, Camera, Minimap, and Theme Flash

## Issues Identified

1. **Properties dialog shows read-only BIM fallback** for objects not in the `assets` table (e.g. walls). The dialog should auto-create a Geminus asset row from BIM metadata so users get the full editable view.

2. **Pure 2D mode shows objects from wrong floors** — `ViewerToolbar.tsx` styles ALL metaObjects globally without storey-scoping. An `IfcSpace` from floor 10 appears when floor 04 is selected.

3. **Properties dialog not pinnable** and doesn't update when selecting new objects with the Select tool.

4. **Camera indicator in SplitPlanView** — the coordinate math is verified correct per xeokit's `worldPosToStoreyMap` source. The likely issue is that `storeyAABB` used for the camera indicator may not match the actual image bounds when entities are hidden during capture (hidden entities shrink the rendered image but the AABB stays the same). Need to use the storey map's own `width`/`height` and the xeokit `worldPosToStoreyMap` method directly instead of manual math.

5. **MinimapPanel** uses the same manual coordinate math. Should use xeokit's built-in `worldPosToStoreyMap` for accuracy.

6. **Theme flash on filter panel open** — when the filter panel opens it likely triggers a re-render cycle before the active theme is applied, briefly showing native model colors.

## Changes

### 1. Auto-create Geminus asset from BIM metadata (`UniversalPropertiesDialog.tsx`)
In the `fetchData` function, after the BIM fallback block (line ~198-237), instead of just setting `bimFallbackData`, auto-insert an asset row into `assets` table:
- Extract: fm_guid (entityId), category (from IFC type mapping), name, building_fm_guid (from parent hierarchy), level_fm_guid (from storey parent), asset_type (IFC type)
- Insert with `is_local: true`, `created_in_model: true`
- Then re-fetch and set `assets` state so the full editable dialog renders
- This eliminates the read-only fallback for any BIM object

### 2. Storey-scope 2D mode in ViewerToolbar (`ViewerToolbar.tsx`)
In the 2D styling block (~line 800-860):
- Get the currently selected floor's storey ID from the floor selection event or session storage
- Build storey descendant set (same pattern as SplitPlanView)
- For entities NOT in the storey descendants: hide + unpickable
- This prevents IfcSpace from floor 10 appearing when floor 04 is selected

### 3. Pinnable + auto-updating Properties dialog (`NativeViewerShell.tsx`)
- Add `pinnedProperties: boolean` state
- When pinned, the dialog stays open and `propertiesEntity` updates whenever a new object is selected (via Select tool click handler)
- Modify `handleSelectClick` (line ~387-419): when properties dialog is pinned, update `propertiesEntity` with newly selected entity
- Add a pin/unpin button to the UniversalPropertiesDialog header

### 4. Fix camera indicator using xeokit's built-in method (`SplitPlanView.tsx`)
In the camera position update effect (~line 645-708):
- Instead of manual `normX`/`normZ` + inversion math, use `plugin.worldPosToStoreyMap(map, [eye[0], eye[1], eye[2]], imagePos)` 
- Convert imagePos to percentage: `x = (imagePos[0] / map.width) * 100`, `y = (imagePos[1] / map.height) * 100`
- This guarantees the camera dot matches the exact same projection as the storey map image

### 5. Fix MinimapPanel camera using same method (`MinimapPanel.tsx`)
Same change as #4 — replace manual math with `worldPosToStoreyMap`.

### 6. Fix theme flash on filter panel open (`ViewerFilterPanel.tsx` or `NativeViewerShell.tsx`)
- On filter panel mount, don't re-apply colors. Ensure the current viewer theme is preserved during panel visibility toggle.
- Check if opening the filter panel triggers a `recolorArchitectObjects` call that resets to native colors before the theme re-applies.

## Files to modify
- `src/components/common/UniversalPropertiesDialog.tsx` — auto-create asset, pin support
- `src/components/viewer/NativeViewerShell.tsx` — pin state, select-updates-properties
- `src/components/viewer/ViewerToolbar.tsx` — storey-scoped 2D mode
- `src/components/viewer/SplitPlanView.tsx` — use `worldPosToStoreyMap`
- `src/components/viewer/MinimapPanel.tsx` — use `worldPosToStoreyMap`

