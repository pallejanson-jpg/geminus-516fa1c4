

## Fix: Obstructing Objects, Auto-Color Default, Context Menu Merge, IFC Categories, Space Selection

Five issues identified and their fixes:

---

### 1. Green objects still obstructing the 3D view

The current code excludes `IfcSpace` and `IfcSlab`/`IfcSlabStandardCase` from solidIds (lines 520-533), but the green objects in the screenshot are likely **IfcRoof** and/or **IfcCovering** entities, which are NOT excluded. These large surface objects block the view just like slabs.

**Fix**: Expand the `obstructTypes` set (line 523) to also include `IfcRoof`, `IfcCovering`, and `IfcPlate`. These will be hidden when a floor filter is active, matching the behavior in the 2D mode logic.

**File: `src/components/viewer/ViewerFilterPanel.tsx`, lines 523-524**

```typescript
// Before
const obstructTypes = new Set(['IfcSpace']);
const slabTypes = new Set(['IfcSlab', 'IfcSlabStandardCase']);

// After
const obstructTypes = new Set(['IfcSpace', 'IfcRoof', 'IfcCovering']);
const slabTypes = new Set(['IfcSlab', 'IfcSlabStandardCase', 'IfcPlate']);
```

---

### 2. Auto-coloring should be OFF by default

Currently `autoColorEnabled` starts as `true` (line 109). The user wants no coloring until they opt in.

**Fix**: Change default to `false`.

**File: `src/components/viewer/ViewerFilterPanel.tsx`, line 109**

```typescript
const [autoColorEnabled, setAutoColorEnabled] = useState(false);
```

---

### 3. Context menu: merge Asset+ commands into the Geminus menu

The CSS override hides the Asset+ DevExtreme menu, but the Asset+ viewer also captures `contextmenu` events internally before our React handler fires. This causes the old menu to sometimes appear.

**Fix**: Add a native DOM `contextmenu` listener directly on the canvas element (not the React wrapper) with `capture: true` to intercept before Asset+. This ensures our menu always wins. The existing `onContextMenu` React handler stays as fallback.

**File: `src/components/viewer/AssetPlusViewer.tsx`**
- After viewer initialization (in `handleAllModelsLoaded`), attach a capturing `contextmenu` listener on the xeokit canvas element that calls `preventDefault()` and `stopImmediatePropagation()`, then dispatches our custom context menu state.

---

### 4. Categories should show IFC types (Door, Window, Wall...) instead of Asset+ categories

The user wants granular IFC-level categories (Door, Window, Wall, Slab, Stair, Column, Beam, etc.) listed individually -- not the coarse Asset+ groupings (Instance, Space, Building Storey).

**Fix**: Replace the `categories` useMemo that counts Asset+ `category` field with one that scans the xeokit `metaScene` for actual IFC types, groups them, and counts entities per type. Remove the Supabase Instance count query (no longer needed). The `categoryToIfcTypes` mapping already has the right IFC types defined, so we reuse it in reverse to build the list.

**File: `src/components/viewer/ViewerFilterPanel.tsx`**

| Lines | Change |
|---|---|
| 202-234 | Replace Asset+ category counting with xeokit metaScene IFC type scanning. Build categories from `metaScene.metaObjects` by grouping IFC types into human-readable names using the reverse of `categoryToIfcTypes`. |
| 212-224 | Remove the Supabase `instanceCount` query and state -- no longer needed. |
| 491-504 | Update category filter logic: when a category checkbox is checked, use `categoryToIfcTypes` to find matching IFC types (already works correctly). |

The categories list will show entries like: Wall (2340), Door (890), Window (650), Slab (120), Space (807), Building Storey (10), Column (45), etc.

---

### 5. Selecting a Space in the filter panel blanks the 3D view

When a space checkbox is toggled, `checkedSpaces` changes trigger `applyFilterVisibility`. The space filter uses `entityMapRef` which maps space fmGuids to xeokit IDs. The issue is that when `spaceIds` is computed (lines 483-489), it only contains the direct descendants of the IfcSpace meta-object. In the intersect step (line 508), if `levelIds` is also active, the intersection of level descendants and space descendants may produce an empty set (since space entities are children of the storey and already included in level descendants).

**Fix**: When spaces are checked, automatically include their parent level in the filter to avoid empty intersections. Also, if ONLY spaces are checked (no levels), use the space IDs directly without intersecting with an empty level set. The current code at line 508 already handles this correctly via the `filter` for non-null sets, but the issue is that space checkbox + level checkbox creates conflicting intersections.

The real fix: when a space is checked, ensure its parent level is automatically added to `checkedLevels` (or skip the level filter when spaces are active). This mirrors the floor selection behavior.

**File: `src/components/viewer/ViewerFilterPanel.tsx`**
- In the intersect logic (lines 507-518): if `checkedSpaces.size > 0`, skip `levelIds` from the intersection (spaces already imply their parent level). This prevents the empty-intersection problem.

---

### Technical Summary

**File: `src/components/viewer/ViewerFilterPanel.tsx`**

| Change | Lines |
|---|---|
| Expand obstructTypes to include IfcRoof, IfcCovering; slabTypes to include IfcPlate | 523-524 |
| Default autoColorEnabled to false | 109 |
| Replace Asset+ category counting with xeokit metaScene IFC type scan | 202-234 |
| Remove instanceCount Supabase query | 212-224 |
| Skip levelIds in intersection when spaces are checked | 507-518 |

**File: `src/components/viewer/AssetPlusViewer.tsx`**

| Change | Lines |
|---|---|
| Add capturing contextmenu listener on xeokit canvas to block Asset+ menu | Post-init (~handleAllModelsLoaded) |

**File: `src/index.css`**
- Strengthen CSS overrides to also target `.dx-overlay-content .dx-context-menu` and any popup wrappers.

