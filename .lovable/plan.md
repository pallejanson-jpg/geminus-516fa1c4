

# Plan: Fix 2D Object Picking, Clip Height Sliders, and Select Tool

## Findings

### 1. Select tool doesn't work by default
**Root cause**: In `NativeViewerShell.tsx` line 388, the click handler checks `if (activeToolRef.current !== 'select') return;`. But `activeTool` starts as `null` in `ViewerToolbar` (line ~48). So clicking objects does **nothing** until the user explicitly activates the Select tool button. Users expect click-to-select to work immediately.

**Fix**: Change the guard in `NativeViewerShell.tsx` so selection works when `activeToolRef.current` is `'select'` **or** `null` (no tool active). Only block selection when measure or slicer is active.

```typescript
// Line 388: change from
if (activeToolRef.current !== 'select') return;
// to
if (activeToolRef.current === 'measure' || activeToolRef.current === 'slicer') return;
```

### 2. 2D room picking works correctly (code verified)
The 2D mode styling (ViewerToolbar lines 810-817) correctly:
- Sets IfcSpace entities to `pickable: true`, `opacity: 0.15`, offset Y by `-0.3`
- Sets all other objects (walls, doors, furniture) to `pickable: true`
- The Y-offset ensures furniture/equipment wins pick priority over rooms

This is implemented correctly. The issue users see is actually **Problem 1** — selection doesn't fire because the select tool isn't active by default.

### 3. Clip height sliders — both are wired and functional
- **2D clip height** (VisualizationToolbar line 948): dispatches `CLIP_HEIGHT_CHANGED_EVENT` → `updateFloorCutHeight` in ViewerToolbar (line 271). **Works**.
- **3D ceiling clip** (line 963): dispatches `CLIP_HEIGHT_3D_CHANGED` → `update3DCeilingOffset` (line 277-283). Slider is disabled when `is2DMode || !isSoloFloor` — this is correct behavior. It only activates when a single floor is isolated in 3D mode.

Both sliders are functional. The 3D slider appearing "stuck" is because no floor is solo'd. No code change needed.

### 4. Stale closure in external tool listener
The `useEffect` in ViewerToolbar (line 598-617) that listens for external `VIEWER_TOOL_CHANGED_EVENT` includes `activeTool` in deps. This causes the listener to re-register on every tool change, which could miss events during the transition. Better to use a ref.

**Fix**: Use `activeToolRef` pattern (like NativeViewerShell does) instead of the state variable in the deactivation logic.

## Changes

| File | Change |
|------|--------|
| `NativeViewerShell.tsx` | Change select guard: allow clicks when no tool active (`null`), only block for `measure`/`slicer` |
| `ViewerToolbar.tsx` | Use ref for `activeTool` in external tool listener to avoid stale closures |

