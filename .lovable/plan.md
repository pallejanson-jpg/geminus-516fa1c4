

# Fix Asset Grid and Room Grid: Sticky Header, User Defined Columns, and Selection Behavior

## Problem Summary

Three issues to fix in the Asset grid (`AssetsView.tsx`) and Room grid (`RoomsView.tsx`):

1. **Header row scrolls away** -- when scrolling down in either grid, the column header row disappears
2. **Missing User Defined property columns in Asset grid** -- the Room grid already discovers and shows User Defined properties from the `attributes` object, but the Asset grid only shows hardcoded System and Status columns
3. **Properties dialog opens immediately on selection** -- clicking a row in the grid opens the properties dialog right away. The correct behavior is: click to select/highlight, then use the "Egenskaper" button in the toolbar to view properties

---

## Change 1: Sticky Table Header (both grids)

**Files:** `AssetsView.tsx`, `RoomsView.tsx`

Both grids render `<TableHeader>` inside a `<ScrollArea>`. The fix is to make the header row sticky so it stays at the top when scrolling.

In the `SortableColumnHeader` component (shared by both files), the `<TableHead>` already has `className="bg-muted/50"`. Add `sticky top-0 z-10` to make it stick to the top of the scroll container.

Also add the same sticky classes to the non-sortable header cells (the checkbox column and the actions column) so the entire header row stays pinned.

Specifically for `<TableHeader>`:
- Add `className="sticky top-0 z-10 bg-background"` to the `<TableHeader>` element
- This ensures the entire row stays visible, including checkbox and action columns

---

## Change 2: Add User Defined Columns to Asset Grid

**File:** `AssetsView.tsx`

The Room grid already has this logic (lines 207-245 in `RoomsView.tsx`). The same approach will be applied to the Asset grid:

- Scan all asset `attributes` objects to discover User Defined Properties (objects with `{name, value, dataType}` structure)
- Add them to `allColumns` alongside the existing System and Status columns
- Extract values using the same `extractPropertyValue` pattern from RoomsView
- Add a "Anvandardefinierade" (User Defined) section in the column selector dropdown so users can toggle them on/off

**Current state** (`AssetsView.tsx` line 317):
```
const allColumns = [...SYSTEM_COLUMNS, ...STATUS_COLUMNS];
```

**After change:** Dynamic discovery identical to RoomsView -- scans `localAssets` for attribute keys that are objects with `name` and `value` properties.

Also update the column selector dropdown (currently only shows "Systemegenskaper" and "Status" sections) to include a third "Anvandardefinierade" section.

Update the `assetData` mapping (lines 322-352) to also extract User Defined property values using the same `extractPropertyValue` helper.

---

## Change 3: Decouple Selection from Properties Dialog

**Files:** `AssetsView.tsx`, `RoomsView.tsx`

Both files have a `useEffect` that auto-opens the properties dialog whenever rows are selected:

```typescript
// AssetsView lines 202-209, RoomsView lines 192-199
useEffect(() => {
  if (selectedRows.size > 0) {
    setShowPropertiesFor(Array.from(selectedRows));
  } else {
    setShowPropertiesFor(null);
  }
}, [selectedRows]);
```

**Fix:** Remove this `useEffect` entirely from both files. The `showPropertiesFor` state should only be set when the user explicitly clicks the "Egenskaper" button in the selection toolbar (which already exists and calls `handleShowSelectedProperties`).

Additionally, add an "Egenskaper" button to the per-row actions column so users can open properties for a single row without having to select it first via checkbox.

---

## File Summary

| File | Changes |
|---|---|
| `src/components/portfolio/AssetsView.tsx` | Sticky header, discover User Defined columns from attributes, remove auto-open useEffect, add per-row edit button |
| `src/components/portfolio/RoomsView.tsx` | Sticky header, remove auto-open useEffect, add per-row edit button |

## Behavior After Changes

1. **Scrolling**: The header row with column names stays fixed at the top as you scroll through rows
2. **Column selector** (Asset grid): Now shows three sections -- Systemegenskaper, Status, and Anvandardefinierade -- with all discovered properties available as toggleable columns
3. **Selection flow**: Click checkbox or row to select/highlight (no dialog opens). Click "Egenskaper" in the toolbar to view properties of selected items. Or click the edit icon in the row's action column to open properties for that specific item.

