

# Fix Virtual Twin: Slider, Alignment Close, and Toolbar Interactivity

## Problem 1: Visibility slider not fully visible

The ghost opacity slider (line 473) has `className="w-20"` which is only 80px wide. In the header toolbar it gets cramped and partially clipped. The fix is to widen the slider and ensure the container has enough space.

**File:** `src/pages/VirtualTwin.tsx`
- Change slider width from `w-20` to `w-28` (112px) for better usability
- Add `min-w-[140px]` to the container div to prevent clipping

## Problem 2: Alignment menu does not close after saving

The AlignmentPanel has an `onSaved` callback prop, but VirtualTwin never passes it (lines 514-518). After a successful save, `onSaved?.()` is called in AlignmentPanel but since VirtualTwin doesn't provide the callback, nothing happens.

**File:** `src/pages/VirtualTwin.tsx`
- Pass `onSaved={() => setShowAlignment(false)}` to AlignmentPanel so the panel closes automatically after saving

## Problem 3: 3D toolbars not functioning

This is the core issue. In SDK mode, the entire 3D layer is wrapped in a div with `pointer-events: none` (line 341):

```text
<div style={{ pointerEvents: 'none' }}>    <-- Blocks ALL clicks
  <AssetPlusViewer ... />
    <ViewerToolbar />                       <-- Can't receive clicks!
    <FloatingFloorSwitcher />               <-- Can't receive clicks!
    <ViewerTreePanel />                     <-- Can't receive clicks!
</div>
```

The `pointer-events: none` is correct for the 3D **canvas** (so clicks pass through to Ivion below), but it also blocks all toolbar buttons inside AssetPlusViewer.

**Fix:** Add `pointer-events: auto` to the interactive UI elements inside AssetPlusViewer when in Virtual Twin mode. The toolbar, floor switcher, and tree panel need to opt back in to receiving pointer events.

**File:** `src/components/viewer/AssetPlusViewer.tsx`
- Add `pointer-events: auto` to the ViewerToolbar container (line 3051)
- Add `pointer-events: auto` to the FloatingFloorSwitcher container (line 3043)
- Add `pointer-events: auto` to the ViewerTreePanel container (line 3062)
- Add `pointer-events: auto` to the properties dialog and other interactive overlays
- The 3D canvas itself remains `pointer-events: none` so Ivion still receives navigation events

**Note:** The `suppressOverlay` prop already correctly hides the duplicate close/fullscreen/hamburger buttons (which Virtual Twin provides in its own header). The bottom ViewerToolbar should NOT be suppressed -- it provides essential tools like select, measure, section plane, rooms etc.

## Technical Details

### Pointer events fix approach

The ViewerToolbar already renders at `z-20` with `position: absolute`. By adding `pointer-events-auto` to it (and the other UI elements), clicks on the toolbar buttons will work, while clicks on the transparent 3D canvas still pass through to Ivion.

```text
After fix:

<div style={{ pointerEvents: 'none' }}>     <-- Canvas clicks pass to Ivion
  <AssetPlusViewer>
    <canvas ... />                            <-- 3D rendering (transparent)
    <ViewerToolbar pointer-events-auto />     <-- Clickable!
    <FloatingFloorSwitcher pointer-events-auto />  <-- Clickable!
    <ViewerTreePanel pointer-events-auto />   <-- Clickable!
  </AssetPlusViewer>
</div>
```

### Alignment panel close

```typescript
// VirtualTwin.tsx - AlignmentPanel section
<AlignmentPanel
  transform={transform}
  onChange={setTransform}
  buildingFmGuid={buildingInfo.fmGuid}
  onSaved={() => setShowAlignment(false)}  // <-- Close panel after save
/>
```

### Slider width

```typescript
// VirtualTwin.tsx - Ghost opacity slider
<div className="flex items-center gap-2 bg-white/10 rounded px-3 py-1 min-w-[160px]">
  <Eye className="h-3.5 w-3.5 text-white/70 shrink-0" />
  <Slider
    value={[ghostOpacity]}
    onValueChange={([v]) => setGhostOpacity(v)}
    min={0}
    max={100}
    step={5}
    className="w-28"
  />
  <span className="text-xs text-white/70 w-8 text-right shrink-0">{ghostOpacity}%</span>
</div>
```

## File Summary

| File | Changes |
|---|---|
| `src/pages/VirtualTwin.tsx` | (1) Widen slider from w-20 to w-28 with min-width container, (2) Pass `onSaved` to AlignmentPanel to close it after save |
| `src/components/viewer/AssetPlusViewer.tsx` | Add `pointer-events-auto` to ViewerToolbar, FloatingFloorSwitcher, ViewerTreePanel, and other interactive UI elements so they work inside the `pointer-events: none` Virtual Twin wrapper |

## Risk Assessment

- **Slider width**: No risk. Cosmetic change only.
- **Alignment close**: No risk. Simple callback connection.
- **Pointer events**: Low risk. Only adds `pointer-events: auto` to elements that are already absolutely positioned above the canvas. In standalone viewer mode (without Virtual Twin), the parent div does not have `pointer-events: none`, so adding `pointer-events: auto` has no effect. In Virtual Twin mode, it enables toolbar clicks while the canvas remains transparent to input.

