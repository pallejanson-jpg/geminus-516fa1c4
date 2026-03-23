

# Fix Plan: Filter Menu, Insights & Viewer Themes

## Issues Summary

1. **Red spaces visible when opening Filter** — Spaces (IfcSpace) are shown in red when the Filter menu opens. They should be hidden by default. The red color likely comes from a theme/colorize issue where spaces get non-standard coloring.

2. **Levels not filtered to A-model** — The `aModelSourceGuid` lookup fails because `storey.sourceGuid`/`storey.sourceName` fields don't match what `isArchitecturalModel()` expects. The fallback `!aModelSourceGuid` returns true and shows all levels. Need a different approach: use `sources` list which already has friendly names, and cross-reference.

3. **Space click behavior swapped** — Currently: checkbox = filter, clicking name = flyTo (inside room). User wants: checkbox = zoom to (camera outside), clicking name = camera inside room. Need to swap the behaviors.

4. **Delete 90% alarms** — Already implemented in AlarmManagementTab. Just needs to be triggered. This is a user action, not a code change.

5. **Insights bar chart click doesn't colorize** — The `INSIGHTS_COLOR_UPDATE_EVENT` is dispatched but the event listeners work. Issue is likely that in `drawerMode`, `FORCE_SHOW_SPACES_EVENT` is dispatched but spaces remain hidden because the Filter panel's `applyFilterVisibility` re-hides them in its next cycle. Need to ensure spaces stay visible after force-show.

6. **Show Alarms / Show Annotation buttons don't work** — The `ALARM_ANNOTATIONS_SHOW_EVENT` is dispatched and the handler exists in NativeXeokitViewer. The alarm entities might not match because alarms are DB assets (not in the XKT model). The handler tries to match via `originalSystemId` but alarm fmGuids may not exist in the xeokit scene. Need fallback: show the room instead.

7. **Anthracite background as default in all themes** — Current background is white gradient in NativeViewerShell (line 754). Need to change to anthracite (#2D2D2D or similar dark grey) and update the canvas transparent mode.

## Plan

### 1. Hide spaces by default when Filter opens
**File:** `src/components/viewer/ViewerFilterPanel.tsx`
- In `applyFilterVisibility` (line 851-856), spaces are already hidden by default. The issue is that when the Filter panel first opens with no filters, line 863 does `scene.setObjectsVisible(scene.objectIds, true)` which re-shows spaces before line 866 hides them again. This race may cause a flash. Additionally, spaces might be getting colored red from a previous theme/colorize state. Add explicit space-hide after the "show all" pass and ensure no colorization is applied to spaces during the no-filter state.

### 2. Fix level filtering to A-model
**File:** `src/components/viewer/ViewerFilterPanel.tsx`
- The `aModelSourceGuid` (line 228) finds the A-model from `sharedModels` which have friendly names. But `storey.sourceGuid` contains a raw GUID that doesn't match `sharedModels[i].id`. 
- Fix: Build a `Set<string>` of all source GUIDs that belong to A-models by cross-referencing `sources` (which have friendly names) with `isArchitecturalModel()`. Then filter storeys by checking if their `sourceGuid` is in this set.
- Fallback: If no A-model sources can be identified, show all levels.

### 3. Swap space click vs checkbox behavior
**File:** `src/components/viewer/ViewerFilterPanel.tsx`
- `handleSpaceClick` (line 1499): Currently flies camera to room AABB (camera lands at the space boundary, essentially "inside"). Change this to place camera **inside** the space (keep as-is since `flyTo` with AABB already goes close).
- `handleSpaceToggle` (checkbox, line 1491): Currently only toggles the filter set. Add a zoom-to behavior that positions the camera **outside** looking at the space.
- Actually, the user says: "Selecting with checkbox should zoom to (camera outside). Pressing the room name should place camera inside." Currently `onClick` (name click) calls `handleSpaceClick` which flies to AABB. Need to:
  - **Checkbox** (`onCheckedChange`): After toggling the filter, also fly to the space with a wider AABB (offset/expand to position camera outside).
  - **Name click** (`onClick`): Fly camera inside the space (use tighter AABB or first-person style).

### 4. Insights colorize + Show Alarms
**File:** `src/components/viewer/NativeXeokitViewer.tsx`
- The `ALARM_ANNOTATIONS_SHOW_EVENT` handler already exists and works when entities match. The problem is that alarm assets are database-only records and don't exist as xeokit entities. The handler falls back to rooms (`roomFmGuid`) but rooms (IfcSpace) are hidden by default.
- Fix: In the alarm handler, after matching rooms, explicitly set `entity.visible = true` and also `entity.pickable = true` for the matched room entities. This is already done (lines 1436-1438). The issue might be that room `originalSystemId` doesn't match `roomFmGuid`.
- Add additional fallback matching: try matching room entities by name (from allData lookup).

### 5. Anthracite background for all viewer themes
**File:** `src/components/viewer/NativeViewerShell.tsx` (line 754)
- Change the background gradient from white (`rgb(255,255,255)` → `rgb(230,230,230)`) to anthracite (`#2D2D2D` → `#3A3A3A`).

**File:** `src/hooks/useViewerTheme.ts`
- The theme system doesn't currently set canvas background. Add background color application in `applyTheme` — set the parent container background to anthracite for all themes.

**File:** `src/components/viewer/NativeXeokitViewer.tsx`
- The viewer uses `transparent: true` (line 153), which means the canvas background comes from the parent div. The NativeViewerShell background change handles this.

## Technical Details

- **Level filtering fix**: Create `aModelSourceGuids: Set<string>` from `sources.filter(s => isArchitecturalModel(s.name)).map(s => s.guid)`. Then filter `storeyAssets` by checking `aModelSourceGuids.has(normalizeGuid(storey.sourceGuid))`.
- **Space zoom behavior**: For "camera outside", expand the AABB by 2x before `flyTo`. For "camera inside", use the space center point with `flyTo({ eye, look, up })`.
- **Anthracite color**: Use `#2D2D2D` as the base, gradient to `#3A3A3A`.
- **Alarm matching**: Add a name-based fallback in the ALARM_ANNOTATIONS handler similar to how INSIGHTS_COLOR_UPDATE does it with `nameColorMap`.

