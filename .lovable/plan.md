
# Sidebar Reorganization with Drag-and-Drop App Ordering

## What Changes

### 1. Sidebar Layout - New Fixed Structure

The left sidebar (`LeftSidebar.tsx`) will be reorganized with a visual divider separating two groups:

**Above the divider (primary tools):**
- Inventering
- Felanmalan
- Insights

**Below the divider (platform apps):**
- FMA+
- Asset+
- IoT+ (renamed from "Sensor Dashboard")
- OA+
- 360+ (renamed from "360+ (Ivion)")

The "Home" button stays at the very top (before both groups), as the main landing navigation.

### 2. Rename Apps

| Current Name | New Name |
|---|---|
| Sensor Dashboard | IoT+ |
| 360+ (Ivion) | 360+ |

These renames apply in `DEFAULT_APP_CONFIGS` in `constants.ts` and the sidebar icon color map.

### 3. Drag-and-Drop App Menu Settings

A new "Appar" (Apps) menu item is added to the user dropdown menu in `AppHeader.tsx`. Clicking it opens an **AppMenuSettings** dialog that lets users:

- **Drag and drop** items to reorder them (using the existing `@dnd-kit/sortable` pattern already used in `ToolbarSettings.tsx`)
- **Place visual dividers** -- each item has a "Avdelare under" (divider below) toggle, so users can put dividers wherever they want
- **Reset** to the default order

The order and divider positions are saved to `localStorage` (key: `sidebar-app-order`) and read by `LeftSidebar.tsx`.

### 4. Data Model for Sidebar Items

```typescript
interface SidebarItem {
  id: string;           // e.g. 'inventory', 'fault_report', 'insights', 'fma_plus', etc.
  hasDividerAfter: boolean;  // visual divider below this item
}
```

Default order:
```
[
  { id: 'inventory', hasDividerAfter: false },
  { id: 'fault_report', hasDividerAfter: false },
  { id: 'insights', hasDividerAfter: true },       // <-- divider here
  { id: 'fma_plus', hasDividerAfter: false },
  { id: 'asset_plus', hasDividerAfter: false },
  { id: 'iot', hasDividerAfter: false },
  { id: 'original_archive', hasDividerAfter: false },
  { id: 'radar', hasDividerAfter: false },
]
```

---

## Technical Details

### Files to Create

**`src/components/settings/AppMenuSettings.tsx`** -- New dialog component
- Uses `DndContext` + `SortableContext` with `verticalListSortingStrategy` (same pattern as `ToolbarSettings.tsx`)
- Each row shows: drag handle, app icon + label, divider toggle switch
- Save/Reset/Close buttons
- Persists to `localStorage` under key `sidebar-app-order`

### Files to Modify

**`src/lib/constants.ts`**
- Rename `iot.label` from `'Sensor Dashboard'` to `'IoT+'`
- Rename `radar.label` from `'360+ (Ivion)'` to `'360+'`
- Add new export `DEFAULT_SIDEBAR_ORDER: SidebarItem[]` with the default item order and divider positions

**`src/components/layout/LeftSidebar.tsx`**
- Remove the current hardcoded "Inventory" button and "Home" button separation
- Keep "Home" button at the very top (unchanged, always first)
- Read sidebar order from `localStorage` (falling back to `DEFAULT_SIDEBAR_ORDER`)
- Render items dynamically based on the stored order, including dividers where `hasDividerAfter === true`
- Each item maps to an `id` that resolves its icon, label, color, and click handler (including `inventory`, `fault_report`, `insights`, and the `DEFAULT_APP_CONFIGS` entries)
- Add `fault_report` to the icon color map (with `text-red-500`)

**`src/components/layout/AppHeader.tsx`**
- Add an "Appar" (Apps) menu item to the user dropdown (with a `LayoutGrid` icon)
- Wire it to open `AppMenuSettings` dialog
- Import and render the dialog component

### Interaction Flow

1. User clicks their avatar in the top-right header
2. User sees new "Appar" menu item in the dropdown
3. Clicking it opens the `AppMenuSettings` dialog
4. User drags items to reorder them
5. User toggles "Avdelare" switches to add/remove visual dividers between items
6. User clicks "Spara" -- order is saved to localStorage
7. The sidebar immediately re-renders with the new order

### Sidebar Rendering Logic

```
LeftSidebar renders:
  [Menu toggle button]
  [Home button]            -- always first, not reorderable
  [divider]
  -- dynamic items from saved order --
  for each item in sidebarOrder:
    [AppButton for item.id]
    if item.hasDividerAfter:
      [visual divider line]
```

The item `id` maps to icon/label/handler:
- `inventory` -- ClipboardList icon, "Inventering", `setActiveApp('inventory')`
- `fault_report` -- AlertTriangle icon, "Felanmalan", `setActiveApp('fault_report')`
- `insights` -- BarChart2 icon, "Insights", `setActiveApp('insights')`
- `fma_plus`, `asset_plus`, `iot`, `original_archive`, `radar` -- from `DEFAULT_APP_CONFIGS` with external/internal handling
