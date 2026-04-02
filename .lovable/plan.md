

# Two-part implementation: Viewer flicker fix + Typed event system

## Part 1 — Viewer flicker fix (quick, high impact)

### Problem
`NativeXeokitViewer.tsx` line 284-287: the `useEffect` depends on `initialize` which has 10 dependencies. Any identity change triggers destroy→recreate loop, causing flicker and crashes.

### Fix — single file change
**`src/components/viewer/NativeXeokitViewer.tsx`**:
- Add `const initRef = useRef(initialize); initRef.current = initialize;` after the `initialize` callback
- Change the effect to:
```js
useEffect(() => {
  initRef.current();
  return () => { destroy(); };
}, [buildingFmGuid, destroy]);
```
This ensures initialization only re-runs when the building changes, not when callback references shift.

---

## Part 2 — Typed event system (904 dispatches across 41 files)

Given the scale (41 files, 904 call sites), a full migration in one pass is impractical. Instead: **build the infrastructure first, then migrate incrementally**.

### Step 1: Create `src/lib/event-bus.ts`
A thin, type-safe wrapper around `window.CustomEvent`:

```typescript
type EventMap = {
  INSIGHTS_COLOR_UPDATE: InsightsColorUpdateDetail;
  FLOOR_SELECTION_CHANGED: FloorSelectionEventDetail;
  VIEWER_SELECT_ENTITY: ViewerSelectEntityDetail;
  // ... all existing event types from viewer-events.ts
};

function emit<K extends keyof EventMap>(event: K, detail: EventMap[K]) {
  window.dispatchEvent(new CustomEvent(event, { detail }));
}

function on<K extends keyof EventMap>(event: K, handler: (detail: EventMap[K]) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent).detail);
  window.addEventListener(event, listener);
  return () => window.removeEventListener(event, listener);
}
```

### Step 2: Consolidate all event types into `EventMap`
Move all detail interfaces from `viewer-events.ts` and `useSectionPlaneClipping.ts` into the single `EventMap`. Keep the old constants as re-exports for backward compat.

### Step 3: Migrate the 5 highest-traffic files first
These files account for the most dispatches/listeners:
1. `useViewerEventListeners.ts` — replace `addEventListener` with `on()`
2. `NativeViewerShell.tsx` — replace dispatches with `emit()`
3. `NativeXeokitViewer.tsx` — replace dispatches with `emit()`
4. `RoomVisualizationPanel.tsx` — replace dispatches with `emit()`
5. `FloorVisibilitySelector.tsx` — replace dispatches with `emit()`

Remaining 36 files can be migrated in follow-up sessions. The old `window.CustomEvent` pattern still works because `emit()` dispatches the same underlying events.

### Files created/modified

| File | Action |
|---|---|
| `src/lib/event-bus.ts` | **Create** — typed emit/on/off helpers + EventMap |
| `src/lib/viewer-events.ts` | **Edit** — re-export from event-bus, deprecate raw constants |
| `src/components/viewer/NativeXeokitViewer.tsx` | **Edit** — flicker fix + migrate to emit() |
| `src/hooks/useViewerEventListeners.ts` | **Edit** — migrate to on() |
| `src/components/viewer/NativeViewerShell.tsx` | **Edit** — migrate to emit()/on() |
| `src/components/viewer/RoomVisualizationPanel.tsx` | **Edit** — migrate to emit() |
| `src/components/viewer/FloorVisibilitySelector.tsx` | **Edit** — migrate to emit()/on() |

