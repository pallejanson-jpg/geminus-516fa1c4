

# Plan: Viewer UX Improvements — 2D Mode, Properties, Insights Layout, Filter X-Ray, Split Camera Sync

## Issues Addressed

1. **2D room label click** — flyTo too tight, zoom out more
2. **2D Select tool** — only IfcSpace clickable (room volumes too tall, blocking objects)
3. **2D orbit disabled** — prevent rotation in plan view
4. **Properties panel** — too narrow, GUID truncated, close button invisible
5. **Split 2D/3D floor selection** — should auto-fit view on floor change
6. **Split 2D/3D camera marker** — too small, walls not bold enough
7. **Split 2D/3D camera sync** — 3D doesn't follow 2D clicks (already works via SPLIT_PLAN_NAVIGATE, but may be failing)
8. **Insights panel** — should shrink viewer instead of overlapping; translate remaining strings
9. **All left/right panels** — should shrink viewer, not overlay
10. **Energy chart click** — doesn't color spaces in viewer
11. **Filter X-Ray scope** — when room selected, X-ray only that level, not whole building

---

## Changes

### 1. Room Label Click — Zoom Out More
**File: `src/hooks/useRoomLabels.ts` (~line 349)**
- Current: `flyTo({ aabb: entity.aabb })` which fits tightly to the room AABB
- Fix: Expand the AABB by 1.5x before flying to give overview context:
```typescript
const aabb = [...entity.aabb];
const cx = (aabb[0]+aabb[3])/2, cy = (aabb[1]+aabb[4])/2, cz = (aabb[2]+aabb[5])/2;
const expand = 1.5;
const expanded = [
  cx-(cx-aabb[0])*expand, cy-(cy-aabb[1])*expand, cz-(cz-aabb[2])*expand,
  cx+(aabb[3]-cx)*expand, cy+(aabb[4]-cy)*expand, cz+(aabb[5]-cz)*expand
];
viewer.cameraFlight?.flyTo({ aabb: expanded, duration: 0.8 });
```

### 2. 2D Select — Make Objects Clickable Below IfcSpace
**File: `src/components/viewer/NativeXeokitViewer.tsx`**
- When 2D mode is active, reduce IfcSpace entity height by setting their AABB won't work (read-only). Instead, when entering 2D mode, set IfcSpace entities to `pickable: false` so the Select tool picks through to furniture/equipment below.
- Add listener for `VIEW_MODE_2D_TOGGLED_EVENT`: when enabled, iterate `scene.metaScene.metaObjects`, find IfcSpace types, set `scene.objects[id].pickable = false`. When disabled, restore pickable.

**File: `src/components/viewer/NativeViewerShell.tsx`**
- Add a `useEffect` listening for `VIEW_MODE_2D_TOGGLED_EVENT` that toggles IfcSpace pickability.

### 3. Disable Orbit in 2D Mode
**File: `src/components/viewer/NativeViewerShell.tsx` or `ViewerToolbar.tsx`**
- When 2D mode is active, disable orbit/rotate on the camera controls:
```typescript
viewer.cameraControl.navMode = "planView"; // xeokit built-in plan view mode
```
- Listen for `VIEW_MODE_2D_TOGGLED_EVENT` and toggle between `"orbit"` and `"planView"`.

### 4. Properties Panel — Wider, GUID Visible, Close Button
**File: `src/components/common/UniversalPropertiesDialog.tsx`**
- Desktop panel (line 1482): Change `w-80` to `w-96` (384px instead of 320px)
- Close button (line 1505): Add explicit styling `!text-foreground hover:!text-destructive` to ensure visibility against any background
- GUID display: Find where fmGuid is rendered and add `break-all` or `text-wrap` class to prevent truncation. If it's in a truncated span, remove `truncate` class for the GUID field.

### 5. Split 2D/3D — Auto-Fit on Floor Change
**File: `src/components/viewer/SplitPlanView.tsx`**
- In `handleFloorChange` (around line 1100-1140), after switching floor and generating the map, call `centerImage()` which fits the floor plan to the view.
- This already happens via `onLoad={centerImage}` on the img element. If not working, ensure `centerImage` also dispatches `SPLIT_PLAN_NAVIGATE` with the floor center coordinates so 3D camera flies to the floor.

### 6. Split 2D/3D — Larger Camera Marker, Bolder Walls
**File: `src/components/viewer/SplitPlanView.tsx` (lines 1270-1296)**
- Camera dot: Change from `w-5 h-5` to `w-7 h-7` on desktop, `w-4 h-4` on mobile
- FOV cone: Increase border sizes from `18px` to `24px` on desktop
- Ping ring: Match new dot size
- Wall clarity: The `generateMap` function already uses monochrome rendering. Increase contrast by adding CSS `filter: contrast(1.4)` to the plan image.

### 7. Split 2D/3D Camera Sync — Verify & Fix
The `SPLIT_PLAN_NAVIGATE` event is dispatched from SplitPlanView and handled in UnifiedViewer (line 118-166). This should work. Possible issue: the `__nativeXeokitViewer` global might not be set yet.

**File: `src/pages/UnifiedViewer.tsx` (line 128)**
- Add fallback: also try `viewerInstanceRef.current` chain to get viewer, not just `window.__nativeXeokitViewer`.

### 8. Insights Panel — Shrink Viewer Instead of Overlay
**File: `src/pages/UnifiedViewer.tsx`**
- Currently `InsightsDrawerPanel` is rendered as a bottom panel with `position: absolute`. Change the content layout so the viewer and insights panel are in a flex column, where InsightsDrawerPanel takes its height and the viewer area shrinks:
- Wrap the content area in a flex column. The viewer gets `flex-1` and the InsightsDrawerPanel is a `shrink-0` sibling below it.
- The InsightsDrawerPanel is already structured this way (line 94-99: `shrink-0`). The issue is the parent `contentRef` div uses `relative` positioning with absolute children. Need to restructure so the viewer container and insights panel are flex siblings.

### 9. All Left/Right Panels Shrink Viewer
This is a broader layout change. The Properties panel and Filter panel currently use `fixed` positioning (overlay). To make them shrink the viewer:
- **Properties panel**: Change from `fixed inset-y-0 right-0` to being a flex sibling of the viewer
- **Filter panel**: Same treatment
- This is a significant layout refactor. For now, apply only to the Insights panel (bottom) as it's the most impactful. Left/right panels can remain overlay for this iteration but should be noted for future.

### 10. Energy Chart Click — Color Spaces
**File: `src/components/insights/BuildingInsightsView.tsx`**
- The `handleChartSliceClick` dispatches `INSIGHTS_COLOR_UPDATE_EVENT` and `FORCE_SHOW_SPACES_EVENT`. In drawer mode (inside viewer), this should work. Debug: ensure the `drawerMode` prop path correctly dispatches events without the mobile navigation redirect. Check lines 520-530 — `drawerMode` takes precedence.
- Likely issue: when in drawer mode, the handler dispatches events but `FORCE_SHOW_SPACES_EVENT` might need a delay to allow NativeXeokitViewer to process it before `INSIGHTS_COLOR_UPDATE_EVENT`.
- Fix: Add 100ms delay between `FORCE_SHOW_SPACES_EVENT` and `INSIGHTS_COLOR_UPDATE_EVENT` dispatch.

### 11. Filter X-Ray Scope — Level-Only X-Ray
**File: `src/components/viewer/ViewerFilterPanel.tsx` (lines 1179-1303)**
- Current Tandem cutaway: when a space is selected, X-rays the ENTIRE building (`scene.setObjectsXRayed(allIds, true)` on line 1257)
- Fix: Instead of X-raying all objects, only X-ray objects on the same level as the selected room:
  1. Find the parent storey of the selected space
  2. Collect all object IDs belonging to that storey (from the level's entity map)
  3. Hide all objects NOT on that level (`setObjectsVisible(otherLevelIds, false)`)
  4. X-ray only objects on the same level that are not part of the room
  5. Keep room + contents solid

```typescript
// Find parent level of selected spaces
const parentLevelGuids = new Set<string>();
spaces.forEach(space => {
  if (checkedSpaces.has(space.fmGuid) && space.levelFmGuid) {
    parentLevelGuids.add(space.levelFmGuid);
  }
});

// Get all entity IDs on those levels
const levelEntityIds = new Set<string>();
parentLevelGuids.forEach(levelGuid => {
  const ids = entityMapRef.current.get(levelGuid) || [];
  ids.forEach(id => levelEntityIds.add(id));
});

// Hide everything not on the level
const allIds = scene.objectIds;
const otherIds = allIds.filter(id => !levelEntityIds.has(id) && !spaceOnlyEntityIds.has(id));
scene.setObjectsVisible(otherIds, false);

// X-ray level objects (except room contents)
const levelXrayIds = [...levelEntityIds].filter(id => !spaceOnlyEntityIds.has(id) && !roomContentIds.has(id));
scene.setObjectsXRayed(levelXrayIds, true);
```

## Technical Details

- `navMode = "planView"` is a built-in xeokit mode that disables orbit rotation while keeping pan and zoom
- The `__nativeXeokitViewer` global is set in NativeXeokitViewer after initialization — the SPLIT_PLAN_NAVIGATE handler may fire before this is ready
- Insights panel layout change from absolute to flex requires adjusting the viewer container from `absolute inset` to `flex-1 relative`
- IfcSpace pickability toggle is low-cost (just sets a boolean per entity, no geometry changes)

