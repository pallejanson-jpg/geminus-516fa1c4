

# Plan: Fix Room Color Visualization Filter

## Problem
Console shows `Room visualization: 0 rooms (floor: 1 floors selected)` — the visualization finds zero rooms to colorize because:

1. **Floor filter too aggressive**: When the floor selector initializes, it fires a `FLOOR_SELECTION_CHANGED_EVENT` with only 1 floor GUID. The `RoomVisualizationPanel` receives this and filters rooms by `levelFmGuid`, but rooms either lack `levelFmGuid` or it doesn't match the event's GUID format.

2. **`isAllFloorsVisible` ignored when GUIDs present**: The event handler (line 96-106) sets `eventFloorGuids` to the GUID array even when `isAllFloorsVisible` is true, causing unnecessary filtering.

3. **Rooms without `levelFmGuid` silently dropped**: Line 283 (`if (!room.levelFmGuid) return false`) removes any room that doesn't have a level association, even when those rooms should still be colorized.

## Changes

### File: `src/components/viewer/RoomVisualizationPanel.tsx`

1. **Fix floor event handler** (~line 96): When `isAllFloorsVisible` is true, always set `eventFloorGuids` to `null` regardless of whether GUIDs are also in the payload — this skips the floor filter entirely when all floors are visible.

2. **Include rooms without levelFmGuid** (~line 282): Change the filter to also include rooms where `levelFmGuid` is null/undefined — they belong to the building but have no floor association, so they should still be colorized when any floor filter is active.

These two changes ensure the visualization works regardless of how the floor selector initializes, matching the behavior the user had before.

