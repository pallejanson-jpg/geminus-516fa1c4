

# Migrate remaining ~27 files to typed event bus

## Already migrated (12 files)
FloatingFloorSwitcher, AnnotationCategoryList, MobileViewerOverlay, InventoryPanel, ModelVisibilitySelector, FloorCarousel, VisualizationQuickBar, ViewerThemeSelector, VisualizationLegendOverlay, NativeViewerShell, NativeXeokitViewer, RoomVisualizationPanel.

## Remaining files (grouped into 4 batches)

### Batch A — Viewer components (8 files)
1. `SplitPlanView.tsx` — ~5 dispatches, ~3 listeners
2. `ViewerFilterPanel.tsx` — heavy dispatches + listeners
3. `AssetPlusViewer.tsx` — largest file, ~15 dispatches, ~10 listeners
4. `VisualizationToolbar.tsx` — ~12 dispatches
5. `ViewerToolbar.tsx` — ~5 dispatches, ~3 listeners
6. `ViewerRightPanel.tsx` — ~8 dispatches, ~3 listeners
7. `AnnotationToggleMenu.tsx` — dispatches
8. `ViewerContextMenu.tsx` — dispatches

### Batch B — Hooks (10 files)
1. `useSectionPlaneClipping.ts` — ~5 listeners, remove duplicate constants
2. `useRoomLabels.ts` — constants + dispatches/listeners
3. `useViewerTheme.ts` — constants + dispatches/listeners
4. `useArchitectViewMode.ts` — constants + dispatches/listeners
5. `useLightingControls.ts` — constants + dispatches
6. `useObjectMoveMode.ts` — ~3 listeners
7. `useVoiceCommands.ts` — ~4 dispatches
8. `useAiViewerBridge.ts` — ~2 dispatches/listeners
9. `useIleanData.ts` — ~2 listeners
10. `useRoomLabelConfigs.ts` — listeners

### Batch C — Pages and panels (6 files)
1. `UnifiedViewer.tsx` — ~5 dispatches/listeners
2. `ViewerMockup.tsx` — ~7 dispatches
3. `BuildingInsightsView.tsx` — ~10 dispatches
4. `InsightsDrawerPanel.tsx` — ~2 dispatches
5. `GeminusPluginMenu.tsx` — ~3 dispatches/listeners
6. `IleanEmbeddedChat.tsx` — listener

### Batch D — Misc components (3 files)
1. `GunnarButton.tsx` — app event listeners only (skip native mouse/resize)
2. `DataConsistencyBanner.tsx` — ~1 dispatch
3. `SyncProgressBanner.tsx` — listener

### Also need event-bus.ts additions
Some events found in code but missing from `EventMap`:
- `OBJECT_MOVE_MODE` — detail with entityId, position, etc.
- `OBJECT_DELETE` — detail with entityId
- `VOICE_SETTINGS_CHANGED` — detail with settings object
- `SIDEBAR_SETTINGS_CHANGED` — detail with items array
- `LEVEL_LABELS_TOGGLE` — `{ enabled: boolean }`
- `AI_VIEWER_COMMAND` — command detail object
- `xeokit-pick` — pick event detail (if appropriate)

### Migration pattern (unchanged)
```typescript
// Before:
window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
window.addEventListener(EVENT_NAME, handler as EventListener);
window.removeEventListener(EVENT_NAME, handler as EventListener);

// After:
emit('EVENT_NAME', detail);
const off = on('EVENT_NAME', handler);
// cleanup: off();
```

### What stays unchanged
- Native browser events (mousemove, mouseup, touchmove, resize, keydown, scroll, click)
- `window.addEventListener('message', ...)` in ApiSettingsModal
- `window.addEventListener('storage', ...)` in useSidebarOrder
- Drag handlers in VoiceControlButton, MinimapPanel

### Execution order
1. Add missing events to `EventMap` in `event-bus.ts`
2. Migrate Batch A (8 viewer components)
3. Migrate Batch B (10 hooks) — also remove duplicate exported constants
4. Migrate Batch C (6 pages/panels)
5. Migrate Batch D (3 misc components)

### Risk
Zero behavioral change — `emit()`/`on()` use the same `window.CustomEvent` mechanism under the hood.

