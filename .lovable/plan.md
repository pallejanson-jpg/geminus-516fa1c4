

# Plan: Fix Asset Loading, Performance & Move Actions to Toolbar

## Summary

Three changes across AssetsView, RoomsView, and Navigator: (1) remove the incorrect `isAccSourcedBuilding` bail-out so all buildings show assets, (2) filter out IfcAlarm and add row pagination for performance, (3) move per-row action buttons to a selection toolbar in all three components.

---

## 1. Fix Asset Loading for All Buildings

**File: `src/components/portfolio/AssetsView.tsx`** (lines 259-264)

Remove the `isAccSourcedBuilding` check entirely. All buildings — whether from Asset+, ACC, or IFC — store Instance assets in the same `assets` table. If the DB returns 0 assets, proceed to trigger sync regardless of source.

Also remove the `isAccSourcedBuilding` import.

---

## 2. Performance: Filter IfcAlarm + Row Pagination + Column Scan Limit

**File: `src/components/portfolio/AssetsView.tsx`**

- **Filter IfcAlarm** in `assetData` useMemo (line 402): add `.filter(a => (a.asset_type || a.assetType) !== 'IfcAlarm')` after dedup.
- **Limit column scan** (line 348): change `localAssets.forEach(...)` to `localAssets.slice(0, 100).forEach(...)`.
- **Row pagination**: add `const [rowLimit, setRowLimit] = useState(200)`. Render `filteredAssets.slice(0, rowLimit)` in TableBody. Add a "Show more" button below table when truncated.

---

## 3. Move Per-Row Actions to Selection Toolbar

The goal: remove per-row action buttons that render for every row (causing thousands of Button+Tooltip components). Instead, use single-click to select a row, and a header toolbar for actions.

### 3a. AssetsView (`src/components/portfolio/AssetsView.tsx`)

- **Remove** the `Actions` column header (line 971) and per-row action cell (lines 993-1054).
- **Enhance** the existing selection toolbar (lines 900-935) to always show when `selectedRows.size > 0`, adding: "Open 3D" button, individual "Properties" button (already there).
- **Single-click** on a row toggles selection (modify `onClick` at line 979 to toggle `selectedRows` instead of calling `onSelectAsset`).
- **Double-click** opens Properties for that asset.

### 3b. RoomsView (`src/components/portfolio/RoomsView.tsx`)

- **Remove** the `Actions` column header (line 687) and per-row action cell (lines 719-746).
- **Enhance** the existing selection toolbar (around line 613) to include "Open 3D" and "Properties" buttons operating on selected rows.
- Single-click selects, double-click opens 3D.

### 3c. Navigator (`src/components/navigator/VirtualTreeRow.tsx` + `NavigatorView.tsx`)

- **VirtualTreeRow**: Remove all action buttons (lines 117-245). Keep only: indentation, expand/collapse chevron, label, badges. Add an `onSelect` callback — clicking the row calls it.
- **VirtualTree**: Add `onSelect` prop, pass through to rows.
- **NavigatorView**: Add `selectedNode` state. When a node is selected, show a compact toolbar below the search bar with context-aware actions based on `selectedNode.category`:
  - Building: View, 3D, Inventory, Work Order
  - Building Storey: 2D, 3D, Inventory, Work Order
  - Space: 3D, Add Child, Inventory, Work Order
  - Instance: 3D, View, Sync, Work Order

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/portfolio/AssetsView.tsx` | Remove ACC check, filter IfcAlarm, row pagination, move actions to toolbar |
| `src/components/portfolio/RoomsView.tsx` | Remove per-row actions, enhance selection toolbar |
| `src/components/navigator/VirtualTreeRow.tsx` | Remove action buttons, add onSelect click |
| `src/components/navigator/VirtualTree.tsx` | Add onSelect prop passthrough |
| `src/components/navigator/NavigatorView.tsx` | Add selectedNode state + context toolbar |

