

# ViewerMockup Refinements + Native Color Support

## Part 1: ViewerMockup Changes (`src/pages/ViewerMockup.tsx`)

### 1. All text to English
- Building name: "Office Building A"
- Floors: Roof, Floor 3, Floor 2, Floor 1, Lobby, Basement
- All labels, menu items, drawer titles, back buttons

### 2. Remove "Floors" from hamburger menu
- Remove `floors` from `MENU_ITEMS` and its sub-sheet — the floating pill is sufficient

### 3. Edge-to-edge canvas
- Bottom toolbar: replace `bg-background/90` with transparent gradient (`linear-gradient(to top, rgba(0,0,0,0.5), transparent)`)
- Canvas already covers `absolute inset-0` — buttons keep safe-area padding

### 4. Toolbar customization via Settings button
- Add `ALL_AVAILABLE_TOOLS` array (~10 tools: orbit, pan, fit, select, measure, section, xray, firstPerson, annotations, markup)
- New state: `enabledTools: string[]` defaults to current 6
- Gear icon as last item in toolbar — opens `toolbarConfig` sub-sheet with toggle switches
- Bottom bar renders only enabled tools + the settings button

### 5. "Open IFC" menu item
- Add to menu with Upload icon
- Triggers hidden `<input type="file" accept=".ifc,.xkt">`
- Shows toast "IFC loaded (local only)" as placeholder

---

## Part 2: Model Colors — Your Question

**Yes, you're right.** The ACC screenshots show Revit's original material colors (textured facades, colored mullions, etc.). The reason Geminus looks different is **not** because the IFC data lacks those colors — it's because we **overwrite** them.

Currently, every time a model loads, `applyArchitectColors()` runs and replaces all object colors with a fixed palette (warm beige walls, grey slabs, green furniture). The original XKT/IFC colors are discarded.

The "Model Native Colour" theme already exists in `useViewerTheme.ts` and restores originals — but only if they were captured before the overwrite. The fix is straightforward:

### What to change in the real viewer (separate task, not mockup)

| File | Change |
|------|--------|
| `src/lib/architect-colors.ts` | Before overwriting, store each entity's original `colorize` value in a global `Map` so it can be restored |
| `src/hooks/useViewerTheme.ts` | When "Model Native Colour" is selected, read from that stored map instead of relying on the theme hook's own capture (which may run after architect colors already applied) |
| `src/components/viewer/NativeXeokitViewer.tsx` | After all models load, capture original colors BEFORE calling `applyArchitectColors()` |

This would let users toggle between "Architect" (our clean palette) and "Native" (Revit's original materials) — matching what ACC shows.

### Testing with the real building
Since you have both the IFC and the ACC version of the same building, you could:
1. Load the IFC in Geminus → switch to "Model Native Colour" theme → compare with ACC screenshots
2. The colors should match because XKT preserves the IFC material colors — we just need to stop overwriting them before capturing

This is a separate implementation task from the mockup changes above.

---

## Files to change now

| File | Changes |
|------|--------|
| `src/pages/ViewerMockup.tsx` | English text, remove floors menu, edge-to-edge toolbar, toolbar config with settings button, Open IFC menu item |

## Future task (not this PR)

| File | Changes |
|------|--------|
| `src/lib/architect-colors.ts` | Capture original colors before overwriting |
| `src/hooks/useViewerTheme.ts` | Use captured originals for Native Colour theme |
| `src/components/viewer/NativeXeokitViewer.tsx` | Capture originals before first `applyArchitectColors()` call |

