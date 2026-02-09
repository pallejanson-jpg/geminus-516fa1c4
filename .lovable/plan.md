
# Fix 3D Viewer: Dark Overlay, Model Names, and Floor Selection

## Issue A: Screen too dark when side menu opens

**Root cause**: The `Sheet` component in `ViewerRightPanel.tsx` uses the default Radix Dialog overlay which applies `bg-black/80` (80% opacity black) over the entire screen. This makes the 3D viewer nearly invisible when the settings panel is open.

**Fix**: Set `modal={false}` on the `Sheet` in `ViewerRightPanel.tsx`. This removes the dark overlay entirely while keeping the panel functional. The panel already has `bg-card/95 backdrop-blur-md` styling, so it remains readable without the overlay. A click-outside handler will be added to close the panel when clicking on the viewer area.

| File | Change |
|---|---|
| `src/components/viewer/ViewerRightPanel.tsx` | Add `modal={false}` to the Sheet component |

---

## Issue B: BIM model names are wrong + not all models listed

**Root cause (names)**: The model name shown ("myModel undefined 0 6476.59593...") is the fallback applied when name resolution fails. The `ModelVisibilitySelector` tries to match scene model IDs (which are file hashes like `6476595934a...xkt`) against the `xkt_models` database table (which is empty) and then against the Asset+ GetModels API response (where matching by `xktFileUrl` extraction also fails because the URL structure doesn't align with the scene model ID).

**Root cause (missing models)**: The `additionalDefaultPredicate` parameter (position 9) is currently set to `undefined`. According to the Asset+ documentation, this predicate controls "which **additional** models should be loaded." The base model (referenced by the displayed fmGuid) always loads, but `undefined` means **no additional models** are loaded. For a building like Sma Viken with 4 models (A, 1B, 1E, V), only the base model loads, so the others never appear in the scene or the selector.

**Fix (load all models)**: Change `additionalDefaultPredicate` from `undefined` to `() => true` in the `assetplusviewer()` call. This tells Asset+ to load ALL available models for the building. The `ModelVisibilitySelector` already has logic to default only A-models to visible (line 359-371), so the other models will be loaded but hidden initially.

**Fix (names)**: Add a new matching strategy in `ModelVisibilitySelector.extractModels()` that reads the model name from the xeokit metaScene. Each loaded model has a root `IfcProject` meta-object whose `name` property often contains the human-readable model name. This serves as a reliable fallback when the API-based name mapping fails. Additionally, after a successful API fetch, persist the model metadata to the `xkt_models` database table so future loads have cached names.

| File | Change |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | Change `additionalDefaultPredicate` from `undefined` to `() => true` |
| `src/components/viewer/ModelVisibilitySelector.tsx` | Add Strategy 6: extract name from metaScene IfcProject root; persist API results to xkt_models table |

---

## Issue C: Only one floor selected on startup

**Root cause**: The `FloorVisibilitySelector` persists the user's floor selection to `localStorage` (key: `viewer-visible-floors-{buildingFmGuid}`). When the user previously isolated floor "03 Etasje" and then left the viewer, that selection was saved. On re-entry, the saved selection is restored, showing only 03 Etasje as selected -- even though the viewer renders all floors until `applyFloorVisibility` runs.

The user's requirement is clear: **all floors should be selected by default every time the 3D viewer starts**.

**Fix**: Remove the localStorage restoration for floor selections. The initialization in `FloorVisibilitySelector` will always default to all floors visible. The localStorage save logic can remain (it doesn't hurt), but the restoration on mount will be removed so every viewer session starts fresh with all floors ON.

| File | Change |
|---|---|
| `src/components/viewer/FloorVisibilitySelector.tsx` | Remove localStorage restoration of floor selection; always default to all floors visible |

---

## Complete File Summary

| File | Changes |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | Change `additionalDefaultPredicate` from `undefined` to `() => true` to load all building models |
| `src/components/viewer/ViewerRightPanel.tsx` | Set `modal={false}` on Sheet to remove dark overlay |
| `src/components/viewer/ModelVisibilitySelector.tsx` | Add metaScene IfcProject name fallback (Strategy 6); persist API model names to xkt_models table |
| `src/components/viewer/FloorVisibilitySelector.tsx` | Remove localStorage floor selection restoration; always start with all floors selected |

## Risk Assessment

- **Dark overlay removal (A)**: Low risk. The `modal={false}` prop is documented Radix behavior. The panel remains fully functional.
- **Model predicate (B)**: Low risk. `() => true` is the documented pattern for loading all models. The ModelVisibilitySelector already handles default visibility (A-models only).
- **Model names (B)**: Medium risk. The metaScene fallback depends on the IfcProject node containing a meaningful name. If it doesn't, the existing fallback (cleaned filename) remains.
- **Floor selection (C)**: Low risk. Simply removes stale state restoration. Users can still isolate floors during a session; the change only affects initial state.
