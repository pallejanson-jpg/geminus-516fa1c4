

# Fix All Remaining Event Bus TypeScript Errors

## Problem
25+ TypeScript errors across 6 files. All are the same root cause: handlers passed to `on()` still expect `Event`/`CustomEvent` objects but `on()` passes the unwrapped `detail` directly.

## Files and Fixes

### 1. `src/components/viewer/AssetPlusViewer.tsx` (~18 errors)

**Line 515**: `(e: Event)` → `(detail: InsightsColorUpdateDetail)`, remove line 516 (`const detail = (e as CustomEvent...).detail`), use `detail` directly throughout.

**Line 694**: `async (e: Event)` → `async (detail: AlarmAnnotationsShowDetail)`, remove line 695 (`const detail = (e as CustomEvent...).detail`), change `detail?.visible` to `detail.visible`, `detail?.alarms` to `detail.alarms`.

**Line 1110**: Handler `() => void` for `MINIMAP_TOGGLE` — this is fine, error says otherwise. Need to check if `MINIMAP_TOGGLE` is typed as `void` in EventMap. If it has a detail type, add parameter.

**Lines 3549, 3560, 3568**: Gunnar handlers still use `(e: CustomEvent<...>)` with `e.detail.xxx` — change to `(detail: ...)` and `detail.xxx`. These also still use `window.addEventListener` — migrate to `on()`.

**Line 4478-4485**: `emit('FLOOR_SELECTION_CHANGED', {...})` missing `floorId` property — add `floorId: floorFmGuid`.

### 2. `src/components/viewer/SplitPlanView.tsx` (1 error)

**Line 593-594**: Handler parameter is `(detail: FloorSelectionEventDetail)` but line 594 redeclares `const detail = (event as CustomEvent...).detail` — this is a duplicate variable plus the parameter name `event` doesn't exist. Fix: remove line 594, use the `detail` parameter directly.

### 3. `src/components/viewer/ViewerFilterPanel.tsx` (2 errors)

**Line 652**: Handler already has correct signature `(detail: FloorSelectionEventDetail)` — this should be fine. Double-check the error is stale.

**Line 1649**: Handler already has correct signature `(detail: { themeId: string })` — should be fine.

### 4. `src/components/viewer/ViewerRightPanel.tsx` (1 error)

**Line 478**: `(e: Event)` → `(detail: IssueMarkerClickedDetail)`, remove `(e as CustomEvent...).detail` cast on line 479, use `detail.issueId` directly.

### 5. `src/components/viewer/RoomVisualizationPanel.tsx` (1 error)

**Line 101**: Handler already has correct signature — verify error is stale.

### 6. `src/components/viewer/GeminusPluginMenu.tsx` (1 error)

**Line 70**: Handler already has correct signature — verify error is stale.

### 7. `src/components/portfolio/RoomsView.tsx` (1 error)

**Line 505**: `selectOnly` property — already fixed in code I read (now uses `VIEWER_ZOOM_TO_OBJECT`). Verify error is stale.

## Also: Add missing Gunnar events to EventMap

Add to `event-bus.ts`:
- `GUNNAR_SHOW_FLOOR: { floorFmGuid: string }`
- `GUNNAR_HIGHLIGHT: { fmGuids: string[] }`
- `GUNNAR_FLY_TO: { fmGuid: string }`

Then migrate lines 3574-3581 from `window.addEventListener` to `on()`.

## Summary
The actual broken handlers are concentrated in `AssetPlusViewer.tsx` (lines 515, 694, 3549-3572) and `ViewerRightPanel.tsx` (line 478), plus the duplicate variable in `SplitPlanView.tsx` (line 594). Several other errors may be stale from the previous build. Total: ~8 handler signatures to update, 1 duplicate variable to remove, 3 Gunnar events to add to EventMap.

## After This
With these fixes, the build should be clean. Combined with everything done today, the app will be production-ready except for the 3 strategic items you're deferring (window globals removal, `any` types, test coverage). Everything else from the morning review is either fixed or in the "nice to have" category (z-index adoption, loading spinners, i18n).

