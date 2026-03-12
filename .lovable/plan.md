

# Plan: Viewer UX Improvements (8 Items)

## Summary
Fix mode switch order, add navigation speed settings, improve floor clipping height, add two new viewer themes, hide obstructing IfcSpace objects, fix split2d3d initial visibility, and improve navigation UX based on xeokit best practices.

---

## 1. Fix Mode Switch Order: 2D → 2D/3D → 3D

The order was agreed as **2D → 2D/3D → 3D** but the desktop header still shows **2D → 3D → 2D/3D**. Mobile split and non-split modes also have inconsistent ordering.

**Changes in `src/pages/UnifiedViewer.tsx`:**

**Desktop (lines 620-622):** Reorder to:
```
2D → split2d3d → 3D → split → vt → 360°
```

**Mobile split mode (lines 1027-1031):** Reorder to:
```
2D → split2d3d → 3D
```

**Mobile non-split mode (lines 1125-1129):** Reorder to:
```
2D → split2d3d → 3D
```

Also apply **purple active state** in `ModeButton` (line 843): change `bg-white/20 text-white shadow-inner` to `bg-primary text-primary-foreground shadow-inner`.

Remove the mode text label under building name (lines 607-613).

---

## 2. Desktop Navigation Speed Settings in Viewer

Add a "Navigation Speed" slider in the viewer's right-side settings panel (the gear icon toolbar button). Stores values in `localStorage`.

**Files:**
- `src/components/viewer/ViewerToolbar.tsx` — Add a navigation speed section in the settings popover with a slider (0.5x–3x multiplier). On change, apply multiplier to `cameraControl` properties.
- `src/components/viewer/NativeXeokitViewer.tsx` — On init, read the stored speed multiplier and apply it to the desktop `navTuning` values.

The slider controls a single multiplier that scales `dragRotationRate`, `mouseWheelDollyRate`, `panInertia` etc. proportionally.

---

## 3. Floor Clipping Height Fix

Currently `applyCeilingClipping` uses `Math.min(currentFloor.maxY, nextFloor.minY) + 0.05` which clips too low (0.5m above floor). Objects like walls/doors that extend to ceiling height get cut.

**Fix in `src/hooks/useSectionPlaneClipping.ts` (line 420):**
- Use `nextFloor.minY` as the clip height (the bottom of the next floor slab), not `Math.min(currentFloor.maxY, nextFloor.minY)`.
- This ensures walls/doors up to the next floor boundary are fully visible.
- Cap: if an object's maxY exceeds `nextFloor.minY + 0.5m`, it's an outlier and will be naturally clipped — this is the desired behavior per the user's request.

---

## 4. Two New Viewer Themes

Create two new system themes via database migration:

**a) "Model Native Colour"**
- Empty `color_mappings` (no recoloring — shows original model colors from XKT/IFC)
- `edge_settings: { enabled: false }`
- `space_opacity: 0.15`
- When applied, the theme hook skips all colorization, restoring original model colors.

**b) "Geminus"**
- A curated professional palette inspired by high-end architectural visualization:
  - Walls: warm white `#F5F0E8`
  - Windows/glass: soft blue-tint `#C8D8E4` with edges
  - Doors: warm wood tone `#B8A088`
  - Slabs/floors: light concrete `#E0DCD4`
  - Columns/beams: structural steel `#D0CCC4`
  - Stairs/railings: medium grey `#A8A4A0`
  - Furniture: sage green `#8FAF8A`
  - MEP/proxy: muted blue `#9DB4C8`
  - Spaces: transparent `opacity: 0.08`
- `edge_settings: { enabled: true }` with very subtle edges (color `#D8D4CC`, alpha 0.12)
- Background: warm off-white gradient (bottom: `#E8E4DC`)

**Files:**
- New database migration to insert these two rows into `viewer_themes`.
- `src/hooks/useViewerTheme.ts` — For "Model Native Colour" (empty mappings), add logic to restore original model colors without applying architect palette.

---

## 5. Hide Obstructing IfcSpace "Area" Objects by Default

The screenshot shows a large green IfcSpace named "Area" covering the entire floor like a blanket.

**Current behavior:** `applyArchitectColors` already hides IfcSpace objects (`entity.visible = false; entity.pickable = false`).

**Investigation needed:** The object in the screenshot is visible and green, meaning either:
- It's not being classified as IfcSpace by metaScene, or
- It's being shown again after `applyArchitectColors` runs (e.g., by floor visibility toggle or reset).

**Fix in `src/lib/architect-colors.ts`:**
- Also match `name === 'area'` (case-insensitive) as a hide candidate, regardless of IFC type.

**Fix in `src/components/viewer/FloatingFloorSwitcher.tsx` (line 171):**
- After `setObjectsVisible(idsToShow, true)`, re-hide IfcSpace objects on the visible floor (same logic as `applyArchitectColors`).

---

## 6. Fix Split 2D/3D Initial Visibility

When entering split2d3d mode, some floors are hidden in 3D. This happens because the floor switcher may initialize with a saved solo-floor selection from a previous session, hiding other floors.

**Fix in `src/pages/UnifiedViewer.tsx`:**
- When switching to `split2d3d` mode, dispatch a `FLOOR_SELECTION_CHANGED` event with `isAllFloorsVisible: true` to ensure 3D shows all floors initially.
- Or: in `FloatingFloorSwitcher.tsx`, when `split2d3d` mode is detected, initialize with all floors visible regardless of localStorage.

---

## 7. Navigation UX Improvements (xeokit Best Practices)

Based on xeokit documentation research:

**a) `followPointer: true`** — Already set. Good.

**b) Double-click flyTo stability:**
The issue of "being thrown to wrong position" on double-click happens when `pickSurface` fails and falls back to picking the scene AABB center. Fix in `NativeXeokitViewer.tsx`:
- Listen to `cameraControl` `doublePicked` / `doublePickedSurface` events.
- Only execute `flyTo` when `pickResult.worldPos` is valid (not NaN, not at scene origin if camera is far away).
- Add a sanity check: if the picked point is >50m vertically from current eye, reject it.

**c) `constrainVertical` for first-person mode:**
- When user switches to first-person navigation (`navMode: 'firstPerson'`), set `cc.constrainVertical = true` to prevent falling through floors.

**d) `planView` nav mode for 2D:**
- When in 2D mode, set `cc.navMode = 'planView'` for top-down navigation without rotation.

**Files:** `src/components/viewer/NativeXeokitViewer.tsx`, `src/components/viewer/ViewerToolbar.tsx`

---

## 8. Batch Re-process: Include Asset+ and ACC Sources

Update the `batch-enqueue` action in `conversion-worker-api` to also find buildings with XKT models sourced from Asset+ sync and ACC sync, not just IFC uploads.

**File:** `supabase/functions/conversion-worker-api/index.ts`
- Query `xkt_models` table for all distinct `building_fm_guid` values.
- Create conversion jobs for each, regardless of source (IFC upload, Asset+, ACC).

---

## Implementation Order
1. Mode switch order + purple active state + remove mode text
2. Hide IfcSpace/Area objects after floor visibility changes
3. Fix split2d3d initial all-floors visibility
4. Floor clipping height fix
5. Navigation UX improvements (double-click guard, constrainVertical, planView)
6. Navigation speed slider in viewer settings
7. Two new viewer themes (database migration + hook logic)
8. Batch re-process expansion

**Files touched:**
- `src/pages/UnifiedViewer.tsx`
- `src/components/viewer/NativeXeokitViewer.tsx`
- `src/components/viewer/ViewerToolbar.tsx`
- `src/hooks/useSectionPlaneClipping.ts`
- `src/lib/architect-colors.ts`
- `src/components/viewer/FloatingFloorSwitcher.tsx`
- `src/hooks/useViewerTheme.ts`
- `supabase/functions/conversion-worker-api/index.ts`
- New database migration for viewer themes

