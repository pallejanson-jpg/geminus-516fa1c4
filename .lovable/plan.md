

# Performance & Floor Switcher Fixes

## Problem 1: Småviken loads ALL 4 models (~150MB) on desktop
The A-model-only filtering at lines 602-613 in `NativeXeokitViewer.tsx` only applies to **mobile** (`if (isMobileRef.current)`). On desktop, all models are loaded with just priority ordering. This means Småviken loads ~150MB including HVAC, electrical, etc.

**Fix:** Apply the same A-model-only initial load strategy on desktop. Secondary models should be deferred to lazy-load queue (same as mobile), loaded silently after the viewer is ready. The user can enable them via the filter panel.

**File:** `src/components/viewer/NativeXeokitViewer.tsx` (lines 602-613)
- Remove the `isMobileRef.current` guard so the A-model split applies to all devices
- Desktop uses higher concurrency (2) for lazy secondary loading vs mobile (1)

## Problem 2: Floor switcher — desktop uses vertical pill column, not the compact mobile-style design
The `FloatingFloorSwitcher` renders vertical pills stacked on the left for desktop. The user wants the compact horizontal pill bar (like mobile) also on desktop — centered at the bottom above the toolbar.

**Fix:** Redesign the desktop layout of `FloatingFloorSwitcher` to match the mobile style:
- Horizontal bar, centered at bottom, above the toolbar
- Dark semi-transparent background with backdrop blur (`bg-black/50 backdrop-blur-md rounded-full`)
- Compact pill buttons in a row
- Keep the same click/double-click behavior

**File:** `src/components/viewer/FloatingFloorSwitcher.tsx` (lines 190-280)
- Change the desktop layout from `left-3 flex-col top-[140px]` to bottom-centered horizontal like mobile
- Adjust positioning to sit above the ViewerToolbar (~bottom-14)

## Files to Edit
1. `src/components/viewer/NativeXeokitViewer.tsx` — A-model-only loading for all devices
2. `src/components/viewer/FloatingFloorSwitcher.tsx` — Compact horizontal floor pills for desktop

