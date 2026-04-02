

# Migrate remaining files to typed event bus (`emit`/`on`)

## Scope

42 files currently use `window.dispatchEvent(new CustomEvent(...))` and/or `window.addEventListener` for app-specific events. 5 were already migrated. This plan covers the remaining **~37 files**, grouped by priority and complexity.

## Approach

The migration is mechanical — replace `window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }))` with `emit('EVENT_NAME', detail)` and replace `window.addEventListener(EVENT_NAME, handler)` / `window.removeEventListener(...)` with `const off = on('EVENT_NAME', handler)` / `off()`. No behavioral changes.

### Pre-requisite: Expand `EventMap` with missing events

Several events used across the codebase aren't yet in the `EventMap`. These need to be added first:

| Event | Detail type |
|---|---|
| `VIEWER_THEME_CHANGED` | `{ themeId: string }` |
| `LIGHTING_CHANGED` | `{ enabled: boolean }` |
| `SUN_STUDY_CHANGED` | `{ enabled: boolean }` |
| `REAPPLY_MODIFICATIONS` | `void` |
| `FLOOR_PILLS_TOGGLE` | `{ visible: boolean }` |
| `OPEN_ISSUE_LIST` | `void` |
| `TOGGLE_NAVIGATION_PANEL` | `void` |
| `VIEWER_FLY_TO` | `{ fmGuid: string }` |
| `VOICE_FLOOR_SELECT` | `{ floorNumber: string }` |
| `VOICE_CREATE_ISSUE` | `void` |
| `VOICE_CLEAR_FILTERS` | `void` |
| `INITIAL_VISUALIZATION_REQUESTED` | `{ type: string }` |
| `GUNNAR_AUTO_OPEN_VOICE` | `void` |
| `ARCHITECT_MODE_REQUESTED` | `{ enabled: boolean }` |
| `ARCHITECT_MODE_CHANGED` | `{ enabled: boolean }` |

### Batch 1 — High-traffic viewer components (~15 files)

These are the core viewer UI files with the most dispatches/listeners:

1. **`ViewerFilterPanel.tsx`** — ~20 dispatches, ~5 listeners
2. **`AssetPlusViewer.tsx`** — ~15 dispatches, ~10 listeners (largest file)
3. **`VisualizationToolbar.tsx`** — ~12 dispatches
4. **`ViewerToolbar.tsx`** — ~5 dispatches, ~3 listeners
5. **`ViewerRightPanel.tsx`** — ~8 dispatches, ~3 listeners
6. **`SplitPlanView.tsx`** — ~5 dispatches, ~5 listeners
7. **`FloatingFloorSwitcher.tsx`** — ~3 dispatches, ~2 listeners
8. **`FloorCarousel.tsx`** — ~3 dispatches
9. **`AnnotationCategoryList.tsx`** — ~3 dispatches
10. **`AnnotationToggleMenu.tsx`** — dispatches
11. **`ModelVisibilitySelector.tsx`** — ~2 dispatches, ~1 listener
12. **`InventoryPanel.tsx`** — ~2 dispatches
13. **`MobileViewerOverlay.tsx`** — ~2 dispatches
14. **`ViewerThemeSelector.tsx`** — ~2 listeners
15. **`VisualizationQuickBar.tsx`** — ~1 listener

### Batch 2 — Hooks (~10 files)

1. **`useSectionPlaneClipping.ts`** — ~5 listeners (also exports duplicate event constants to remove)
2. **`useRoomLabels.ts`** — exports constants + ~3 dispatches/listeners
3. **`useViewerTheme.ts`** — exports constants + ~3 dispatches/listeners
4. **`useArchitectViewMode.ts`** — exports constants + ~4 dispatches/listeners
5. **`useLightingControls.ts`** — exports constants + ~2 dispatches
6. **`useObjectMoveMode.ts`** — ~3 listeners
7. **`useVoiceCommands.ts`** — ~4 dispatches
8. **`useAiViewerBridge.ts`** — ~2 dispatches/listeners
9. **`useIleanData.ts`** — ~2 listeners
10. **`useRoomLabelConfigs.ts`** — listeners

### Batch 3 — Pages and other components (~12 files)

1. **`UnifiedViewer.tsx`** — ~5 dispatches/listeners
2. **`BuildingInsightsView.tsx`** — ~10 dispatches
3. **`GeminusPluginMenu.tsx`** — ~3 dispatches/listeners
4. **`ViewerMockup.tsx`** — ~3 dispatches
5. **`InsightsDrawerPanel.tsx`** — ~2 dispatches
6. **`ViewerContextMenu.tsx`** — dispatches
7. **`IleanEmbeddedChat.tsx`** — listener
8. **`SensorDataOverlay.tsx`** — listener
9. **`GunnarButton.tsx`** — listener (only app events, skip mouse/resize)
10. **`FmAccessNativeView.tsx`** — dispatches
11. **`DataConsistencyBanner.tsx`** — ~1 dispatch
12. **`SyncProgressBanner.tsx`** — listener

### Cleanup after migration

- Remove duplicate event constant exports from hooks (`useSectionPlaneClipping`, `useRoomLabels`, `useViewerTheme`, `useArchitectViewMode`, `useLightingControls`) — keep only in `event-bus.ts` and `viewer-events.ts` for backward compat
- Remove `as EventListener` casts (no longer needed with typed `on()`)

### What stays unchanged

- Native browser events (`mousemove`, `mouseup`, `touchmove`, `resize`, `keydown`, etc.) — these are NOT app events and should NOT use the event bus
- `unhandledrejection` and `error` handlers in `App.tsx`
- Drag/resize handlers in `GunnarButton.tsx`, `UniversalPropertiesDialog.tsx`

### Files modified

| File | Changes |
|---|---|
| `src/lib/event-bus.ts` | Add ~15 missing events to `EventMap` |
| ~37 component/hook/page files | Replace `window.dispatchEvent`→`emit`, `window.addEventListener`→`on` |
| `src/lib/viewer-events.ts` | No change (kept for backward compat) |

### Risk

Zero behavioral change — `emit()` calls `window.dispatchEvent(new CustomEvent(...))` under the hood, and `on()` calls `window.addEventListener`. Existing code that hasn't been migrated yet will continue to work because both sides use the same underlying browser events.

