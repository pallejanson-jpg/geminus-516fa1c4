

# Fix: 2D Plan Quality, Camera Indicator, and Click Navigation

## Problem Analysis

### 1. Barely visible 2D content
The current code only styles **walls** (black, edges on) and **slabs** (white, 0.08 opacity). Every other object type — doors, windows, furniture, railings, stairs, spaces, equipment — renders with its **default 3D color** and then gets the CSS filter `grayscale(1) saturate(0) contrast(1.8)`. This creates a messy, faint image because hundreds of random-colored objects bleed into each other.

**Fix**: Before calling `createStoreyMap()`, hide ALL non-structural objects (set opacity 0 or visible=false), keep only walls+columns visible as solid dark gray fills, and optionally show spaces as very light gray fills for room outlines. This produces a clean architectural plan.

### 2. Camera position not visible
The camera dot exists in code (lines 1198-1221) but uses percentage coordinates derived from `(1.0 - normX)` and `(1.0 - normZ)`. The inversion works for some models but not others depending on how `createStoreyMap` orients the image. The dot is also only 4px (`w-4 h-4`) which is tiny at low zoom.

**Fix**: Make the camera dot larger (w-5 h-5), add a pulsing animation ring, and add a bright accent color (blue/orange) instead of relying on `--primary` which may blend with the plan.

### 3. 3D camera goes to wrong position on click
`storeyMapToWorldPos()` returns coordinates but the Y-height comes from the storey AABB bottom which may be floor level. The flyTo sets `eyeHeight = floorY + 1.5` which is correct. The issue is likely that `storeyMapToWorldPos` returns inverted X/Z for the same reason as the camera indicator — the coordinate mapping between image pixels and world space depends on the storey map orientation.

**Fix**: Verify coordinate mapping by logging worldPos vs expected, and ensure the same inversion logic is used consistently.

## Changes

### File: `src/components/viewer/SplitPlanView.tsx`

**A. Aggressive monochrome styling (lines 438-477)**
Replace current partial styling with:
- Hide ALL entities on the storey first (opacity 0)
- Show walls/columns as dark gray (0.3, 0.3, 0.3) with edges, opacity 1
- Show spaces (IfcSpace) as very light gray (0.95, 0.95, 0.95) with opacity 0.5 for room outlines
- Show doors/windows as medium gray (0.7) with opacity 0.4 for context
- Keep slabs hidden (opacity 0)
- Increase `edgeWidth` to 4
- Remove the CSS `filter: grayscale(1) saturate(0) contrast(1.8)` since we now control colors directly

**B. Bigger, more visible camera indicator (lines 1198-1221)**
- Increase dot size from `w-4 h-4` to `w-5 h-5`
- Add a pulsing ring animation around the dot
- Use explicit blue color (`bg-blue-500`) instead of theme primary
- FOV cone: use matching blue with higher opacity

**C. Increase map resolution**
- Change width multiplier from `3` to `4` and max from `4000` to `6000` (line 413)

**D. Remove CSS filter on img (line 1146)**
- Remove the `filter: 'grayscale(1) ...'` since the pre-render styling now produces a clean monochrome image directly

| Section | Lines | Change |
|---------|-------|--------|
| Entity styling before capture | 438-477 | Hide all, show only walls/spaces/doors |
| CSS filter on img | 1144-1147 | Remove grayscale/contrast filter |
| Map resolution | 412-413 | 4x multiplier, 6000px max |
| Camera indicator | 1198-1221 | Larger dot, pulse ring, blue color |

