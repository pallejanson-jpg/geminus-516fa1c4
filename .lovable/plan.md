
## Fix Plan: Filter Panel Logic, Model Names, and Performance Analysis

### 1. Fix Reversed Filter Behavior in ViewerFilterPanel

The core problem is that the filter logic uses **hide/show** (visibility toggling) instead of **solid/x-ray** (ghosting). This causes checked items to disappear when xeokit ID matching fails.

**Correct behavior (matching Tandem):**
- Nothing checked: all objects visible, no x-ray, no colorization
- Sources checked: objects belonging to unchecked sources become x-ray; checked sources stay solid
- Levels checked: objects on unchecked levels become x-ray; checked levels stay solid
- Spaces checked: all objects become x-ray; checked spaces become solid AND get blue highlight color
- Categories checked: objects not in checked categories become x-ray

**Changes to `applyFilterVisibility` in `ViewerFilterPanel.tsx`:**

1. Remove all `setObjectsVisible(objectIds, false)` calls -- never hide objects, only x-ray them
2. New logic flow:
   - Start by making everything visible, un-x-rayed, un-colorized (clean slate)
   - If any filter is active, collect the set of "selected" xeokit entity IDs across all active filters (intersection logic)
   - X-ray everything, then un-x-ray the selected set
   - If spaces are checked, additionally colorize them blue
3. Fix Categories: actually implement category filtering by matching `checkedCategories` against metaScene object types (IFC types map to Asset+ categories)

**File: `src/components/viewer/ViewerFilterPanel.tsx`**
- Rewrite `applyFilterVisibility` (lines 215-306) with the corrected x-ray-based logic
- Add category filtering using xeokit metaScene type matching
- Ensure room labels sync: dispatch a custom event so only checked spaces show labels

### 2. Consistent Model Names in Right-Side Visningsmenyn

The `ModelVisibilitySelector` already uses `useModelNames` but has an 8-strategy fallback chain (lines 131-229) that often fails to match, falling back to raw file names.

**Fix:** Simplify the matching to prioritize `parentCommonName` from the Asset+ data (the same source the filter panel uses successfully).

**File: `src/components/viewer/ModelVisibilitySelector.tsx`**
- After Strategy 2 (file name without extension), add a direct lookup against `parentCommonName` from the assets data
- Remove excessive debug logging (Strategies 6-8 console.debug calls)
- Ensure the display name in the right panel matches the filter panel exactly

### 3. Performance Analysis: Tandem and Dalux vs Geminus

To provide actionable recommendations, I propose fetching the Tandem and Dalux viewers to analyze their loading strategies.

**Analysis approach:**
- Fetch Tandem's viewer page to examine their 3D loading architecture (format, streaming, compression)
- Fetch Dalux FM-viewer similarly
- Compare against Geminus's XKT-based approach

**Key areas to investigate:**
- File format (glTF+DRACO vs XKT vs proprietary)
- Progressive/streaming loading (do they show partial models while loading?)
- Texture handling and compression
- WebGL vs WebGPU usage
- Network request patterns (single large file vs many small chunks)
- Worker thread usage for parsing

This analysis will be presented as findings and concrete recommendations -- no code changes for this part, just research.

---

### Technical Summary of Changes

| File | Change |
|---|---|
| `ViewerFilterPanel.tsx` | Rewrite `applyFilterVisibility`: x-ray unchecked instead of hiding; implement category filtering; fix label sync |
| `ModelVisibilitySelector.tsx` | Simplify name matching to use `parentCommonName` consistently; remove debug logging |
| Research | Fetch and analyze Tandem + Dalux F12 network patterns for performance recommendations |
