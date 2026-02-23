

## Fix Level Labels: Isolation + Dynamic Positioning

### Problem 1: Click-to-isolate does not work

The `useLevelLabels` hook only dispatches a `FLOOR_SELECTION_CHANGED_EVENT` when a label is clicked, but it does **not actually change object visibility** in the scene. The `FloatingFloorSwitcher` listens for this event but only updates its pill UI state -- it does NOT call `applyFloorVisibility` from the event handler. The `FloorVisibilitySelector` does apply visibility from its event handler, but only when it is mounted (right panel open).

**Fix**: `useLevelLabels` must directly apply visibility changes to the xeokit scene, the same way `FloatingFloorSwitcher.applyFloorVisibility` does. Specifically, when a label is clicked:

1. Hide all scene objects: `scene.setObjectsVisible(scene.objectIds, false)`
2. Collect all child entity IDs of the clicked storey's metaObject (recursively)
3. Show those IDs: `scene.setObjectsVisible(childIds, true)`
4. Hide obstructing types (IfcCovering, IfcRoof) on the isolated floor
5. Then dispatch `FLOOR_SELECTION_CHANGED_EVENT` so other components (floor pills, clipping, room labels) stay in sync

When the X close button is clicked (restore all):
1. Show all objects: `scene.setObjectsVisible(scene.objectIds, true)`
2. Then dispatch the restore event

### Problem 2: Labels too close to building / don't move with camera

Currently, labels use a **fixed world position** at `(buildingMinX - 3, centerY, centerZ)`. This means:
- They sit at a fixed point in 3D space to the left of the building
- When the camera rotates, they can end up overlapping or behind the building
- The offset of 3 units is arbitrary and doesn't scale

**Fix**: Replace the fixed world-position approach with a **hybrid screen-space approach**:

- Keep the world Y position (floor elevation) for vertical placement -- this ensures labels align with their floor
- On each camera update, instead of projecting a fixed world point, compute the **screen-space left edge** of the building:
  1. Project the building AABB corners to screen space
  2. Find the minimum screen X across all projected corners (the leftmost pixel of the building)
  3. Place all labels at `screenX = leftEdge - 20px` (constant pixel offset from building edge)
  4. Each label's screen Y comes from projecting `[any X, floorCenterY, any Z]` through the camera

This means labels always float to the left of the building regardless of camera rotation, with consistent pixel-based spacing.

### Technical Changes

**File: `src/hooks/useLevelLabels.ts`**

| Section | Change |
|---|---|
| `isolateFloor` function (lines 152-189) | Add direct scene visibility logic: hide all objects, show only the storey's children, hide IfcCovering/IfcRoof. Keep the event dispatch for syncing other components. |
| `restoreAllFloors` function (lines 137-149) | Add `scene.setObjectsVisible(scene.objectIds, true)` before dispatching the restore event. |
| `createLabels` (lines 192-323) | Remove the fixed `labelX`/`labelZ` world position. Store only `worldY` (floor center elevation) per label instead of a full `worldPos`. |
| `updateLabelPositions` (lines 121-134) | Replace with hybrid approach: (1) project all 8 AABB corners of the scene to screen, find min screen-X; (2) for each label, project a point at the label's worldY to get screen-Y; (3) position label at `(minScreenX - offset, screenY)`. |
| `LevelLabel` interface (lines 14-22) | Change `worldPos: number[]` to `worldY: number` since we only need the elevation. |

No other files need changes -- the event dispatch already syncs FloatingFloorSwitcher and FloorVisibilitySelector correctly.
