

# Plan: Properties Auto-Update, Clickable URLs, AI Scan Building Context, Text Colors, and Filter Reset Colors

## Changes

### 1. Properties panel auto-updates on selection change
**File:** `src/components/common/UniversalPropertiesDialog.tsx`

The panel already updates when pinned in the viewer (line 597-607 in NativeViewerShell). However, the `useEffect` that fetches data (line 180) gates on `isOpen` — when `fmGuids` changes while already open, it should re-fetch. Add `fmGuids` to the dependency array of the main data-fetching `useEffect` (if not already there) so switching selection while the panel is open triggers a fresh load.

### 2. URL values in properties panel become clickable
**File:** `src/components/common/UniversalPropertiesDialog.tsx`

In `renderPropertyValue` (around line 1155-1167), before the default text display, add a URL detection check: if the string value matches `https?://`, render it as an `<a href={value} target="_blank" rel="noopener noreferrer">` styled link instead of plain text.

### 3. AI Scan inherits building context from Inventory
**Files:** `src/pages/Inventory.tsx`, `src/App.tsx`

Currently, navigating to `/inventory/ai-scan` from Inventory doesn't pass the building. The `AiAssetScan` route in `App.tsx` (line 123) renders without props. Fix: pass the selected building GUID as a URL search param (`?building=<guid>`) from `Inventory.tsx`, and in `App.tsx` read that param and pass it as `preselectedBuildingGuid` to `AiAssetScan`.

### 4. Fix text colors across screens for readability
**Files:** `src/components/viewer/VisualizationToolbar.tsx` and potentially other dark-background panels

The right-side toolbar has a dark background but uses `text-muted-foreground` for labels which can appear grey/hard to read. Change key label text classes from `text-muted-foreground` to `text-foreground` or add `!text-white` overrides on the dark-background toolbar sections. Audit section headers and toggle labels.

### 5. Filter menu: "Reset Colors" button on all levels
**File:** `src/components/viewer/ViewerFilterPanel.tsx`

Add a "Reset Colors" button in the filter panel header/footer area. On click, it dispatches `INSIGHTS_COLOR_RESET_EVENT`, clears the `__vizColorizedEntityIds` set, clears `__colorFilterActive`, and calls `applyArchitectColors(viewer)` to restore the default color scheme. This gives users a single action to clear any room visualization or custom coloring from any level.

## Files to Modify

| File | Change |
|------|--------|
| `src/components/common/UniversalPropertiesDialog.tsx` | Auto-update on fmGuids change; render URL values as clickable links |
| `src/pages/Inventory.tsx` | Pass building GUID as URL param when navigating to AI Scan |
| `src/App.tsx` | Read `building` search param and pass to `AiAssetScan` |
| `src/components/viewer/VisualizationToolbar.tsx` | Fix grey text to white/foreground on dark backgrounds |
| `src/components/viewer/ViewerFilterPanel.tsx` | Add "Reset Colors" button that clears all colorization |

## No backend changes needed

