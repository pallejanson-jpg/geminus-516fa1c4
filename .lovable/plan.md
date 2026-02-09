

# Fix Floor Synchronization, Collapse Defaults, and Pill Count

## 1. All right panel sections collapsed by default

Currently the "Visa" (Display) section starts expanded. Change `displayOpen` initial state from `true` to `false`.

| File | Change |
|---|---|
| `src/components/viewer/ViewerRightPanel.tsx` | Change `displayOpen` default from `true` to `false` (line 113) |

## 2. Floating floor switcher: max 8 pills

The current limits are 5 (desktop) and 4 (mobile). Change to 8 for both, which matches the user's requirement. Buildings with more than 8 floors will show the overflow "+N" popover.

| File | Change |
|---|---|
| `src/components/viewer/FloatingFloorSwitcher.tsx` | Change `MAX_VISIBLE_PILLS_DESKTOP` to `8` and `MAX_VISIBLE_PILLS_MOBILE` to `6` (lines 32-33) |

## 3. Synchronize all three floor selectors (A, B, C)

This is the main issue. Currently:

- **A** (FloorVisibilitySelector in right panel): Dispatches `FLOOR_SELECTION_CHANGED_EVENT` but does NOT listen for it
- **B** (ViewerTreePanel / Model tree): Dispatches the event when storey checkboxes change, but does NOT react to incoming events either
- **C** (FloatingFloorSwitcher): Both dispatches AND listens to the event

The fix is to add event listeners to both A and B so changes propagate bidirectionally:

### FloorVisibilitySelector (A)

Add a `useEffect` that listens for `FLOOR_SELECTION_CHANGED_EVENT`. When an event is received (that wasn't dispatched by itself), update the internal `visibleFloorIds` state to match the event's `visibleMetaFloorIds`. Use an `isReceivingExternalEvent` ref (same pattern as FloatingFloorSwitcher) to prevent dispatch loops.

### ViewerTreePanel (B)

Add a `useEffect` that listens for `FLOOR_SELECTION_CHANGED_EVENT`. When received, refresh the visibility state of the tree nodes by calling `refreshVisibilityState()`. This will update the checkboxes to reflect the current scene state (since A and C already change entity.visible in the scene).

### FloatingFloorSwitcher (C)

Already listens correctly. No changes needed.

```text
Sync flow after fix:

User clicks in A (right panel) --> dispatches event --> C updates pills, B refreshes checkboxes
User clicks in B (model tree)  --> dispatches event --> A updates switches, C updates pills
User clicks in C (floating pills) --> dispatches event --> A updates switches, B refreshes checkboxes
```

| File | Change |
|---|---|
| `src/components/viewer/FloorVisibilitySelector.tsx` | Add listener for `FLOOR_SELECTION_CHANGED_EVENT` with loop-prevention ref |
| `src/components/viewer/ViewerTreePanel.tsx` | Add listener for `FLOOR_SELECTION_CHANGED_EVENT` to refresh visibility state |

## 4. Section plane clipping status

The clipping system is already implemented and functional. Here is how it currently works:

- When a single floor is isolated (Solo button), the `FloorVisibilitySelector` calls `updateClipping([floorId])` which triggers `applyCeilingClipping`
- `applyCeilingClipping` finds the next floor's base height (`calculateClipHeightFromFloorBoundary`) and places a SectionPlane at that Y-coordinate, with direction [0,1,0] (discard everything above)
- The "Takklipp (3D Solo)" slider in Viewer Settings adjusts an offset from this boundary
- The system correctly handles: lowest floors, middle floors, and top floor

**Current gap**: When a floor is isolated via the FloatingFloorSwitcher (C) or the Model tree (B), the section plane clipping is NOT triggered because only `FloorVisibilitySelector` (A) calls `updateClipping()`. The other two components change entity visibility but don't invoke the section plane hook.

**Fix**: After the sync fix (item 3 above), when C or B isolate a floor, the event propagates to A, which calls `updateClipping()`. However, A only calls `updateClipping` during `handleFloorToggle` and `handleShowOnlyFloor` (user-initiated actions), not when receiving external events.

To ensure clipping works regardless of which selector triggers the isolation, add clipping logic to the event handler in FloorVisibilitySelector: when the received event indicates solo mode (`visibleMetaFloorIds.length === 1`), call `updateClipping` with that floor ID.

| File | Change |
|---|---|
| `src/components/viewer/FloorVisibilitySelector.tsx` | In the new event listener, also trigger `updateClipping` when receiving a solo-floor event |

## File Summary

| File | Changes |
|---|---|
| `src/components/viewer/ViewerRightPanel.tsx` | Set `displayOpen` default to `false` |
| `src/components/viewer/FloatingFloorSwitcher.tsx` | Update max pill constants to 8/6 |
| `src/components/viewer/FloorVisibilitySelector.tsx` | Add `FLOOR_SELECTION_CHANGED_EVENT` listener with loop prevention and clipping sync |
| `src/components/viewer/ViewerTreePanel.tsx` | Add `FLOOR_SELECTION_CHANGED_EVENT` listener to refresh checkbox state |

## Risk Assessment

- **Collapse defaults**: No risk. Simple initial state change.
- **Pill count**: No risk. Only changes the visual threshold for overflow.
- **Floor sync**: Medium risk. The main concern is dispatch loops. Each component must guard against re-dispatching when receiving an external event. The FloatingFloorSwitcher already uses this pattern successfully (`isReceivingExternalEvent` ref), so the same proven approach will be applied to FloorVisibilitySelector. The ViewerTreePanel only needs to refresh its UI, not dispatch.
- **Clipping sync**: Low risk. Reuses the existing `updateClipping` function which is already proven to work.
