

# Asset Panel Upgrade — Full-Width Bottom Drawer with Advanced Table

## What Changes
Rewrite `InventoryPanel.tsx` to match the feature set of `AssetsView.tsx` (Portfolio):
- **Full-width bottom drawer** spanning entire viewport width on desktop
- **Draggable columns** via `@dnd-kit/core` + `@dnd-kit/sortable` (same pattern as AssetsView)
- **Column selector** dropdown to add/remove columns
- **Sortable columns** with click-to-sort (asc/desc toggle)
- **Per-column filtering** synced with floor selection
- **Fly-to on click** — always fly to the clicked asset (remove the "follow selection" checkbox, just do it)
- **Resizable height** via drag handle on the top border

## Technical Approach

### File: `src/components/viewer/InventoryPanel.tsx` (rewrite)

1. **Column system**: Reuse the same `ColumnDef` pattern from AssetsView with `SYSTEM_COLUMNS` (Name, Type, Category, Level, Room, Systems, FMGUID) and configurable `visibleColumns` + `columnOrder` state.

2. **Drag-and-drop headers**: Import `DndContext`, `SortableContext`, `useSortable` from `@dnd-kit`. Wrap `TableHeader` in `SortableContext` with `horizontalListSortingStrategy`. Use the same `SortableColumnHeader` component pattern.

3. **Sorting**: `sortColumn` + `sortDirection` state. Click header to toggle. Apply `Array.sort()` in the filtered assets memo.

4. **Column selector**: `DropdownMenu` with `DropdownMenuCheckboxItem` for each available column, toggling visibility.

5. **Fly-to**: Every row click dispatches `VIEWER_FLY_TO` event with the asset's `fmGuid` — no checkbox needed.

6. **Layout**: Remove the fixed 400px height. Use a resizable approach: user can drag the top border to resize. Default height ~35vh. Panel sits at `bottom-0` spanning full width inside the viewer flex container.

7. **Floor/search filtering**: Keep existing floor sync via `FLOOR_SELECTION_CHANGED_EVENT` and search input. Add a category filter dropdown.

### File: `src/pages/UnifiedViewer.tsx` (minor edit)
Ensure the InventoryPanel renders outside/below the viewer container so it spans full width, not clipped by sidebars.

### No new dependencies
`@dnd-kit/core` and `@dnd-kit/sortable` are already used by AssetsView.

