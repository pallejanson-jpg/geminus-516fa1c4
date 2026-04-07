

# Fix: 2D Pickability Overridden by Filter Panel

## Problem
The pickability rules set in `NativeViewerShell.tsx` on 2D toggle get immediately overridden when `ViewerFilterPanel.tsx` runs `applyFilterVisibility` — which happens on every filter state change, including the initial render. The filter panel is the final authority on pickability, so the 2D rules must live there.

## Changes

### 1. `src/components/viewer/ViewerFilterPanel.tsx`
- Add a `useRef<boolean>` (`is2DModeRef`) that tracks 2D state via `VIEW_MODE_2D_TOGGLED_EVENT` listener
- At the **end** of `applyFilterVisibility` (after line ~1510, before `prevVisibleRef.current = newVisibleSet`), add a 2D override block:
  - If `is2DModeRef.current` is true, iterate all scene objects using metaScene metadata
  - Structural types (walls, slabs, columns, beams, roofs, coverings, curtain walls, members, railings, plates) → `pickable = false`
  - IfcSpace (rooms, non-area) → `pickable = true`, `visible = true`
  - Everything else visible → `pickable = true` (no change needed, already default)
- When the 2D event fires, also call `applyFilterVisibility()` to re-run with the new mode

### 2. `src/components/viewer/NativeViewerShell.tsx`
- Remove the pickability iteration from the 2D handler (lines 639-657) — keep only `navMode` switch (`planView` / `orbit`)

This ensures the 2D pickability is always the last thing applied, never overridden by filter logic.

