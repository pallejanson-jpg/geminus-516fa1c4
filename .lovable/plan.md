

# Plan: Properties Panel, Floor Names, Sorting, Translations & Viewer Integration Fixes

## Issues Identified

1. **Properties panel in Viewer shows only basic BIM data** — The `UniversalPropertiesDialog` renders as a fixed right-side overlay (`fixed inset-y-0 right-0 z-[70] w-96`) instead of shrinking the viewer canvas. When the asset exists in the DB with full attributes (like Småviken spaces), it should show all properties (System, Area & Dimensions, etc.) as shown in the uploaded screenshot. The issue is likely that the dialog doesn't find the asset because of GUID case mismatch or the `entityId` resolution path falls through to BIM fallback.

2. **Properties panel overlays instead of shrinking** — Currently `position: fixed`. Should use flex layout to shrink the viewer canvas, consistent with the Insights drawer pattern.

3. **Room list sensor buttons should sort** — When pressing Temp/CO2/etc., the list should auto-sort by that metric (high→low). The color indicator column should also be sortable.

4. **Selecting spaces in RoomsView and clicking "3D" should highlight them in viewer** — Currently only supports single selection for 3D. Multi-select should navigate to viewer with all selected GUIDs.

5. **"3D" button should be renamed to "Viewer"** — In selection toolbar.

6. **Floor column empty in RoomsView** — `levelCommonName` is populated from `attrs.levelCommonName || attrs.levelDesignation` but for some buildings these attributes may not exist. Should fall back to looking up the parent storey's `commonName` from the navigator tree.

7. **Wrong floor names in Småviken Portfolio** — Shows "Floor 1", "Floor 2" etc. instead of the actual model names ("01", "04-01", "IE"). This happens in `AppContext.tsx` line 452-454 where nameless storeys get placeholder names like `"${parentName} (floor ${count})"`. The actual storey `commonName` from Asset+ should be used; the fallback is generating wrong names.

8. **Swedish labels in Quick Actions** — "Inventering" and "Felanmälan" should be English: "Inventory" and "Fault Report".

---

## Files to Modify

### 1. `src/components/common/UniversalPropertiesDialog.tsx`
- **Change layout from fixed overlay to flex-integrated panel**: Replace the `fixed inset-y-0 right-0` positioning with a portal or event-based approach that tells the parent (NativeViewerShell) to render the panel in its flex layout, shrinking the canvas.
- Since the dialog is used in multiple contexts (viewer, portfolio, inventory), the simplest approach: dispatch a custom event `PROPERTIES_PANEL_OPEN` with the panel content, and have `NativeViewerShell` render it in a flex sibling to the canvas. Alternatively, keep the dialog component but pass a `renderMode` prop — `'overlay'` (default for portfolio) vs `'inline'` (for viewer).
- **Best approach**: Add an `inline` boolean prop. When `inline=true`, render as a `div` with `w-96 shrink-0 border-l` instead of `fixed`. The parent (NativeViewerShell) wraps canvas + properties in a `flex` row.

### 2. `src/components/viewer/NativeViewerShell.tsx`
- Wrap the canvas and properties panel in a `flex flex-row` container so the properties panel shrinks the canvas.
- Move `UniversalPropertiesDialog` from outside the canvas to inside the flex row as a sibling.

### 3. `src/components/portfolio/RoomsView.tsx`
- **Auto-sort on sensor metric activation**: When `activeSensorMetric` changes to a non-'none' value, auto-set `sortColumn` to a virtual column (sensor value) and `sortDirection` to `'desc'` (high→low).
- **Add sensor value as sortable column**: In `filteredRooms` sort logic, when sorting by the sensor column, use the `roomSensorValues` map.
- **Multi-select 3D**: Change `handleOpen3DSelected` to support multiple GUIDs — navigate to viewer with `entity=guid1,guid2,...` so they're highlighted.
- **Rename "3D" to "Viewer"** in selection toolbar.
- **Fix Floor column**: Fall back to looking up storey commonName from `rooms` array's parent data or the facility's storeys.

### 4. `src/context/AppContext.tsx`
- **Fix floor name derivation** (line 445-456): The storey `commonName` from Asset+ should already be present. The issue is that for some buildings, `storey.commonName` is null/empty even though it exists in Asset+. Check: the actual storey names ("01", "04-01", "IE") must come from the `commonName` field in the `assets` table. If they're missing, the fallback generates "Floor 1" etc. Need to also check `storey.designation` and `storey.attributes?.levelCommonName` before falling back.

### 5. `src/components/portfolio/QuickActions.tsx`
- Rename "Inventering" → "Inventory" (line 172)
- Rename "Felanmälan" → "Fault Report" (line 186)

### 6. `src/components/portfolio/AssetsView.tsx`
- Rename "3D" to "Viewer" in selection toolbar if present.

### 7. `src/components/navigator/NavigatorView.tsx`
- Rename any Swedish labels in the new context toolbar to English.

---

## Technical Details

**Properties panel shrink pattern:**
```
// NativeViewerShell layout
<div className="flex flex-row w-full h-full">
  <div className="flex-1 relative"> {/* canvas + overlays */} </div>
  {propertiesEntity && (
    <UniversalPropertiesDialog inline ... />
  )}
</div>
```

**Sensor sort in RoomsView:**
```typescript
// When activeSensorMetric changes
useEffect(() => {
  if (activeSensorMetric !== 'none') {
    setSortColumn('__sensor__');
    setSortDirection('desc');
  }
}, [activeSensorMetric]);

// In filteredRooms sort:
if (sortColumn === '__sensor__') {
  const aVal = roomSensorValues.get(a.fmGuid) ?? -Infinity;
  const bVal = roomSensorValues.get(b.fmGuid) ?? -Infinity;
  return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
}
```

**Floor name fix in AppContext:**
```typescript
let displayName = storey.commonName || storey.name;
if (!displayName) {
  const attrs = storey.attributes || {};
  displayName = attrs.levelCommonName || attrs.levelDesignation || attrs.designation;
}
if (!displayName) {
  // existing fallback logic
}
```

