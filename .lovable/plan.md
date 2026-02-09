

# Fix Room Label Performance and Ivion SDK Loading

## 1. Room Labels Performance

### Root Cause

In `useRoomLabels.ts`, the `updateLabelPositions` function runs on **every frame** via two redundant listeners:
- `scene.camera.on('matrix', updateFn)` (line 395) -- fires on every camera change
- `scene.on('tick', tickFn)` (line 403) -- fires on EVERY frame (~60fps) regardless of camera movement

Each call iterates ALL labels, computes full 4x4 matrix projections (view + projection), calculates 3D distance for scaling, and does **DOM writes** (`style.left`, `style.top`, `style.transform`, `style.display`) for each label. For a floor with ~100 rooms, that is 100 DOM mutations x 60fps = 6000 DOM writes/second.

### Fix

1. **Remove the `tick` listener entirely** -- camera `matrix` event is sufficient since labels only need updating when the camera moves
2. **Use CSS `transform: translate3d()` instead of `left`/`top`** -- a single `transform` property change triggers GPU compositing only (no layout reflow), vs `left`/`top` which trigger layout recalculation for every label
3. **Batch DOM reads and writes** -- read camera matrices once, compute all positions, then write all DOM changes. Currently reads and writes are interleaved per label
4. **Throttle updates** -- use `requestAnimationFrame` coalescing so multiple rapid camera events only trigger one update per frame
5. **Use `display: none` / `visibility: hidden` more efficiently** -- track which labels changed visibility to avoid unnecessary DOM writes

### Technical Details (`src/hooks/useRoomLabels.ts`)

**Remove tick listener** (lines 401-410): Delete the entire `scene.on('tick')` block. The `camera.on('matrix')` listener is sufficient.

**Throttle via rAF** (lines 391-399): Replace direct `updateFn` call with rAF coalescing:
```typescript
let rafId = 0;
const throttledUpdate = () => {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    updateLabelPositions();
  });
};
scene2.camera?.on?.('matrix', throttledUpdate);
```

**Use transform instead of left/top** (lines 202-224): Change from:
```typescript
label.element.style.left = `${canvasPos[0]}px`;
label.element.style.top = `${canvasPos[1]}px`;
label.element.style.transform = `translate(-50%, -50%) scale(${scale})`;
```
To:
```typescript
label.element.style.transform = `translate3d(${canvasPos[0]}px, ${canvasPos[1]}px, 0) translate(-50%, -50%) scale(${scale})`;
```
And set `left: 0; top: 0` once during label creation (line 334).

**Batch DOM writes**: Compute all positions into an array first, then apply all at once. This avoids layout thrashing from interleaved reads/writes.

## 2. Ivion SDK Loading Failure

### Root Cause

Two competing SDK loading paths exist:
- **`useIvionSdk` hook** (used by UnifiedViewer for VT/360 modes): Creates `<ivion>` element in `sdkContainerRef`, loads SDK
- **`Ivion360View` component** (used for Split mode): Creates its OWN `<ivion>` element in its own container, loads SDK independently

The module-level `activeLoadPromise` guard causes the second loader to wait for the first, but they use DIFFERENT `<ivion>` elements. When the first load's element is in a `display: none` container (line 400: SDK container hidden in split mode), the SDK fails with `offsetHeight` null errors because the NavVis internal code can't measure its DOM elements.

Additionally, switching from split to another mode unmounts `Ivion360View` (conditional render at line 422), destroying its `<ivion>` element mid-initialization.

### Fix

**Consolidate SDK loading**: Use `useIvionSdk` for ALL modes that need SDK (split, vt, 360). Pass the API ref to `Ivion360View` instead of letting it load its own SDK.

Changes:
1. **`src/pages/UnifiedViewer.tsx`**: Change `sdkNeeded` from `viewMode === 'vt' || viewMode === '360'` to also include `'split'`:
   ```typescript
   const sdkNeeded = hasIvion && (viewMode === 'vt' || viewMode === '360' || viewMode === 'split');
   ```

2. **`src/pages/UnifiedViewer.tsx`**: Show the SDK container for split mode too (not just vt/360):
   ```typescript
   display: (viewMode === 'vt' || viewMode === '360' || viewMode === 'split') ? 'block' : 'none',
   ```
   For split mode, position it on the right half:
   ```typescript
   style={{
     display: sdkNeeded ? 'block' : 'none',
     position: 'absolute',
     top: 0,
     right: 0,
     width: isSplitMode ? '50%' : '100%',
     height: '100%',
     zIndex: isSplitMode ? 5 : 0,
   }}
   ```

3. **`src/pages/UnifiedViewer.tsx`**: Remove the conditional `Ivion360View` render (lines 422-432). The SDK container with the shared `useIvionSdk` handles the 360 view directly.

4. **`src/components/viewer/Ivion360View.tsx`**: Add an `externalApi` prop so when used from UnifiedViewer, it skips its own SDK loading entirely and uses the provided API.

5. **`src/hooks/useIvionSdk.ts`**: Ensure the SDK container `display` is set to `block` BEFORE `loadIvionSdk` is called (it already checks element dimensions, but the container might still be hidden during the async gap).

## Files to Modify

| File | Changes |
|---|---|
| `src/hooks/useRoomLabels.ts` | Remove tick listener, add rAF throttling, use `transform: translate3d()` instead of `left/top`, batch DOM writes |
| `src/pages/UnifiedViewer.tsx` | Extend `sdkNeeded` to include split mode, use shared SDK container for split's right panel instead of Ivion360View's own SDK, adjust container positioning |
| `src/components/viewer/Ivion360View.tsx` | Accept optional `externalApi` prop to skip internal SDK loading when API is provided externally |
| `src/hooks/useIvionSdk.ts` | No changes needed (already handles the shared case correctly) |

## Risk Assessment

- **Room labels (low risk)**: Pure performance optimization. Same visual result, fewer DOM operations.
- **SDK consolidation (medium risk)**: Changing from two independent SDK instances to one shared instance. The Ivion360View camera sync hooks need the ivApiRef, which will now come from the parent. Need to verify the sync hooks work with an externally-provided API ref.

