

## Plan: Context-Sensitive Left Sidebar

### Concept

The left sidebar currently shows all items regardless of where the user is. The change: each sidebar item gets a `contexts` array defining when it's visible. The sidebar reads `activeApp` and `selectedFacility` from AppContext to determine the current context level, then filters items accordingly.

### Context Levels

| Level | Condition | Example items shown |
|-------|-----------|-------------------|
| `global` | No building selected (`!selectedFacility`) | Globe, Insights, FMA+, Asset+, IoT+, OA+ |
| `building` | Building selected | 3D Viewer, 360°, Inventory, Fault Report, AI Scan, Insights |
| `viewer` | Inside viewer/360° (`activeApp` is `native_viewer`, `radar`, `asset_plus`) | Inventory, Fault Report, AI Scan, Insights |

Items tagged with multiple contexts appear in all of them. Home button always visible (unchanged).

### Context Assignments

```text
global + building + viewer : insights
global + building          : fma_plus, fma_native, iot, original_archive
global                     : globe
building + viewer          : native_viewer, inventory, fault_report, ai_scan, radar
building                   : asset_plus
```

### Files to Change

1. **`src/lib/sidebar-config.ts`**
   - Add `contexts: ContextLevel[]` to `SidebarItemMeta` interface
   - Add the context array to each item in `SIDEBAR_ITEM_META`

2. **`src/components/layout/LeftSidebar.tsx`**
   - Derive `currentContext` from `activeApp` + `selectedFacility`
   - Filter `sidebarOrder` items: only render if `meta.contexts.includes(currentContext)`
   - Add a subtle label/divider showing current context (e.g. building name when in building context)

3. **`src/components/layout/MobileNav.tsx`**
   - Apply same context filtering to the mobile drawer menu items

### Behavior Details

- Switching from a building-context app back to Home clears `selectedFacility` (existing behavior) → sidebar reverts to global items
- Selecting a building in Portfolio/Map sets `selectedFacility` → sidebar switches to building items
- Opening 3D Viewer narrows to viewer items
- Items not in current context are hidden, not disabled — keeps the sidebar clean
- User's custom ordering (from AppMenuSettings) is preserved; filtering happens on top of ordering

