

## Fix: Room Visualization Performance, Duplicate Toolbar Buttons, Dropdown Consistency, and Smallviken Loading Error

### 1. Room Visualization Performance (Hanging/Freezing)

**Root cause:** When `applyVisualization` runs, it first synchronously resets ALL previously colorized rooms by iterating `colorizedRoomGuidsRef` and calling `colorizeSpace(fmGuid, null)` for each one. For buildings with hundreds of rooms, this means hundreds of synchronous DOM/WebGL operations happening in a tight loop before the chunked processing even begins. Additionally, the `FLOOR_VISIBILITY_APPLIED` listener re-triggers `applyVisualization()` after only 100ms, causing cascading resets.

**Fix:**
- Move the "reset all previously colorized rooms" phase into the same chunked processing loop instead of running it synchronously up front
- Increase the `FLOOR_VISIBILITY_APPLIED` debounce from 100ms to 300ms
- Add a guard to prevent `applyVisualization` from being called if one is already in progress (use `isProcessing` state)
- Reduce the `requestIdleCallback` timeout from 50ms to 16ms (one frame) for smoother yielding

**File:** `src/components/viewer/RoomVisualizationPanel.tsx`

---

### 2. Duplicate Toolbar Buttons (Aterstall vy / Anpassa vy)

**Analysis:** The navigation toolbar has both:
- "Aterstall vy" (`resetView`, icon: `Maximize`) -- calls `assetView.viewFit(undefined, true)` (fit entire scene)
- "Anpassa vy" (`viewFit`, icon: `Focus`) -- calls `assetView.viewFit(selectedItems, false)` when objects are selected, otherwise `assetView.viewFit(undefined, true)` (same as resetView)

When nothing is selected (the majority of the time), both buttons do the exact same thing. The user correctly sees them as duplicates.

**Fix:** Remove the `resetView` tool from the default configuration. Keep `viewFit` ("Anpassa vy") as it has the smarter behavior (fits to selection when available, fits all otherwise). This is a single-line change in `ToolbarSettings.tsx` -- set `resetView` to `visible: false` by default.

**File:** `src/components/viewer/ToolbarSettings.tsx`

---

### 3. Inconsistent Dropdown Styling in Visning Menu

**Analysis:** Three different dropdown patterns are used within the same panel:
- **Rumsvisualisering** (visualization type): Uses `<Select>` component with `<SelectTrigger>` and `<SelectContent>` -- proper Radix dropdown
- **Viewer-tema**: Uses `<Select>` component -- matches Rumsvisualisering
- **Rumsetiketter**: Uses custom `<button>` elements styled inline -- completely different look (no border, no dropdown arrow, no popover)

**Fix:** Convert the "Rumsetiketter" (Room Labels) selector from custom buttons to a `<Select>` dropdown to match the other selectors in the same panel. This gives a consistent UI with the same trigger style, border, arrow indicator, and popover behavior.

**File:** `src/components/viewer/VisualizationToolbar.tsx` (lines 1029-1084)

---

### 4. Smallviken "nextSibling" Loading Error

**Analysis:** The error `Cannot read properties of null (reading 'nextSibling')` occurs inside the AssetPlusViewer UMD bundle during DOM manipulation. The existing fix (`viewerContainerRef.current.innerHTML = ''` at line 2775) already addresses this for most cases, but it can still happen if:
- The container ref becomes null between the check and the initialization
- React strict mode causes double-mount/unmount cycles
- The viewer's internal Vue instance tries to access DOM nodes that React has already removed

**Fix:** Add a more defensive guard around the container clearing and initialization sequence:
- Wrap the initialization in a `requestAnimationFrame` to ensure DOM is settled
- Add a null-check after the container clearing
- Catch the specific `nextSibling` error in the initialization try/catch and retry once after a short delay

**File:** `src/components/viewer/AssetPlusViewer.tsx`

---

### Implementation Order

1. Fix Room Visualization performance (highest user impact -- freezing)
2. Remove duplicate toolbar button (quick fix)
3. Standardize dropdown styling (UI consistency)
4. Harden nextSibling error handling (edge case)

