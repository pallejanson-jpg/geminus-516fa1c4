

# Plan: Fix Filter Persistence + Småviken Portfolio Floors

## Problem 1: Filter Resets When Panel Closes

**Root cause**: Lines 1560-1596 in `ViewerFilterPanel.tsx` contain an explicit cleanup effect that fires when `isVisible` becomes false. It calls `scene.setObjectsVisible(scene.objectIds, true)` — resetting all visibility back to default. This was originally meant to clean up xray/colorize effects, but it also wipes the visibility filter.

**Fix**: When the panel closes and filters are still active (checked sets are non-empty), preserve the visibility state. Only reset xray, colorize, and opacity — do NOT call `setObjectsVisible(all, true)` and do NOT restore model visibility when filters are active.

### File: `src/components/viewer/ViewerFilterPanel.tsx` (lines 1560-1596)

Change the cleanup effect:
- Check if any filter is active: `checkedSources.size > 0 || checkedLevels.size > 0 || checkedSpaces.size > 0 || checkedCategories.size > 0`
- If filters are active: only clean up xray and colorize (visual enhancements), but keep visibility as-is. Re-apply architect colors or theme on the visible objects only.
- If NO filters are active: keep existing full cleanup logic (show everything, reset opacity, etc.)
- Add the checked state sets to the effect's dependency array.

---

## Problem 2: Småviken Floors in Portfolio

**Root cause**: The A-modell storeys in Småviken have `common_name = NULL` and `name = NULL` in the `assets` table. The portfolio page at line 744 falls back to `Floor ${idx + 1}`. Additionally, ALL storeys from ALL models are shown (13 total), not just architectural ones.

This is a **data quality** issue combined with a **display logic** issue.

**Fix (two parts)**:

### Part A: Portfolio should prefer A-model storeys
**File: `src/components/portfolio/FacilityLandingPage.tsx`** (lines 164-179)

Update `childStoreys` memo to prefer A-model storeys when available:
- Import `isArchitecturalModel` from `useFloorData`
- Filter storeys: if any storey has `parentCommonName` matching an architectural model name, only show those. Otherwise show all.
- This matches the filter panel's existing A-model priority logic.

### Part B: Better fallback names for unnamed storeys
**File: `src/components/portfolio/FacilityLandingPage.tsx`** (line 744)

When displaying a storey name, add a smarter fallback:
- Try `storey.commonName || storey.name`
- Then try `storey.attributes?.levelName || storey.attributes?.levelCommonName`
- Then count contained spaces and generate "Level N (X rooms)" based on position index
- The current `Floor ${idx+1}` fallback stays as last resort

### Part C: Room assignment to correct storeys
The rooms in Småviken DO reference A-modell storey GUIDs correctly via `level_fm_guid`. But since the storey carousel shows ALL models' storeys, rooms appear scattered. By filtering to A-model storeys only (Part A), the rooms will group correctly under the 2 unnamed A-modell storeys.

Since there are only 2 A-model storeys with no names, we should also attempt to derive names from the xeokit scene. But since the portfolio doesn't have viewer access, the practical fix is the naming fallback + A-model filtering.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/viewer/ViewerFilterPanel.tsx` | Skip full visibility reset in cleanup effect when filters are active |
| `src/components/portfolio/FacilityLandingPage.tsx` | Filter to A-model storeys; improve unnamed storey fallback labels |

