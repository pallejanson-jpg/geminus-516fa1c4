

# Fix Viewer: Performance, Crashes, Floor Switcher, Properties

## Issues Found

### 1. Lazy-load secondary models causes performance degradation
The secondary models (B, E, V — totaling ~114MB) auto-load 10 seconds after the A-model is ready. This causes massive GPU pressure and makes the viewer sluggish. Småviken has: A-modell (43MB), B-modell (2MB), E-modell (55MB), V-modell (56MB).

**Fix:** Remove auto lazy-loading entirely. Secondary models should ONLY load when the user explicitly enables them via the filter panel's Sources section.

**File:** `src/components/viewer/NativeXeokitViewer.tsx` (lines 971-1016)
- Remove the entire `lazyLoad` block and its 10-second timeout
- Store the `secondaryQueue` in a window global (e.g. `window.__secondaryModelQueue`) so the filter panel can trigger loading on demand
- Dispatch a custom event when A-model is ready with the available secondary model list

### 2. Filter panel crashes / disappears
The `applyFilterVisibility` (line 783) runs a full "clean slate" reset on every filter change:
- `scene.setObjectsVisible(scene.objectIds, true)` — iterates ALL 58,000+ objects
- `applyArchitectColors(viewer)` — iterates ALL metaObjects again
- Hide ALL IfcSpace — iterates ALL metaObjects a third time

This is ~180K object iterations per filter toggle. With 300ms debounce, rapid toggling still queues multiple heavy runs.

**Fix:**
- Skip the `applyArchitectColors(viewer)` call inside `applyFilterVisibility` — it's already been applied on model load and doesn't need re-application on every filter change
- Combine the IfcSpace hiding loop with the existing object iteration
- Add a guard: if `applyFilterVisibility` is already running (via a ref), skip re-entry

**File:** `src/components/viewer/ViewerFilterPanel.tsx` (lines 796-825)

### 3. 2D mode crash: `_textureData is null`
The console shows repeated `TypeError: Cannot read properties of null (reading '_textureData')` when entering 2D mode. This is triggered by `entity.offset = [x, y-0.3, z]` on line 775 of ViewerToolbar.tsx. The xeokit DTXTrianglesLayer crashes when offset is set on entities with destroyed/null texture data (happens with large DTX-compressed models).

**Fix:** Wrap the `entity.offset` assignment in a try-catch to prevent the crash from aborting 2D mode setup.

**File:** `src/components/viewer/ViewerToolbar.tsx` (lines 770-776)

### 4. Floor switcher shows 25+ floors instead of 8-10
The `useFloorData` hook extracts storeys from the A-model correctly (lines 143-186). However, if `aModelObjectIds` doesn't correctly identify all storey entities as belonging to the A-model (because `model.objects` can be empty during loading), non-A storeys slip through.

The real issue: the Floor Switcher shows ALL pills at once, which with 25+ floors is overwhelming. The user wants a collapsed icon that expands on click.

**Fix (two parts):**
1. **Floor data:** Already correctly filters to A-model storeys. The 25+ count likely comes from non-A model storeys leaking in. Add stricter fallback: when `hasAModel && aModelObjectIds.size === 0`, skip the filter entirely and wait for a re-poll.
2. **UI:** Replace the always-visible pill bar with a single collapsed icon button. Clicking it opens a popover with all floors listed. After selecting a floor, the popover closes and returns to the icon.

**File:** `src/components/viewer/FloatingFloorSwitcher.tsx`
- Default state: show a small icon button (e.g. `Layers` icon) with the current floor name as text
- On click: open a Popover listing all floors as clickable rows
- On floor select: close popover, apply floor, show icon with selected floor name
- "All" button at the bottom of the popover

### 5. Properties dialog shows BIM fallback instead of Geminus data
When opening Properties from the viewer context menu, `propertiesEntity.fmGuid` is set from `metaObj.originalSystemId` (line 384 of NativeViewerShell). The `UniversalPropertiesDialog` queries the `assets` table with this GUID (line 146-149).

The problem: the dialog passes `fmGuids={propertiesEntity.fmGuid || propertiesEntity.entityId}` (line 697). If `fmGuid` is null or the GUID doesn't match any asset row (case-sensitivity, GUID format), it falls through to BIM fallback showing raw metadata.

**Fix:** 
- In `NativeViewerShell.handleContextProperties`: also try looking up the entity's `originalSystemId` with normalized GUID comparison against all building assets from AppContext
- If found, pass the correct `fmGuid` from the database asset
- Add a fallback: if `originalSystemId` doesn't match, search `asset_external_ids` table by `entityId`

**File:** `src/components/viewer/NativeViewerShell.tsx` (lines 501-508)
- Enhance `handleContextProperties` to resolve the correct database fmGuid before opening the dialog
- Use `allData` from AppContext to find matching asset by normalized GUID comparison

## Files to Edit
1. `src/components/viewer/NativeXeokitViewer.tsx` — remove auto lazy-load, expose secondary queue
2. `src/components/viewer/ViewerFilterPanel.tsx` — optimize applyFilterVisibility, remove redundant loops
3. `src/components/viewer/ViewerToolbar.tsx` — wrap entity.offset in try-catch for 2D mode
4. `src/components/viewer/FloatingFloorSwitcher.tsx` — collapsed icon UI with popover
5. `src/components/viewer/NativeViewerShell.tsx` — resolve fmGuid properly before opening Properties

