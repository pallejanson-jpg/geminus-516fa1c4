

## Plan: 3D Viewer UX Improvements -- Toolbar Cleanup, Performance, Contrast, Camera Sync & Alignment

This plan addresses seven distinct issues reported in the 3D viewer.

---

### 1. Remove Duplicate Tools from Navigation Toolbar (ToolbarSettings)

**Problem:** Several tools exist in both the Navigation toolbar (bottom) and the Visualization menu (right panel): "Visa/Dolj rum", "X-ray", "Minimap", and "Rumsvisualisering".

**Changes to `ToolbarSettings.tsx`:**
- Remove from `VISUALIZATION_TOOLS` array:
  - `xray` (X-ray lage)
  - `spaces` (Visa/dolj rum)
  - `visualization` (Rumsvisualisering)
- Move `minimap` from `VISUALIZATION_TOOLS` to be handled exclusively by ViewerRightPanel
- Increment `SETTINGS_VERSION` to 7 to force localStorage reset for all users

**Changes to `ViewerToolbar.tsx`:**
- Remove the `xray` case from the overflow menu builder (`getOverflowItems`), since X-ray is only in the right panel now

**Result:** Navigation toolbar only has navigation/interaction tools. Visualization controls live exclusively in the right panel (ViewerRightPanel).

---

### 2. Add Minimap Toggle to ViewerRightPanel

**Problem:** Minimap has no toggle in the Visualization menu. It exists as `showMinimap` state inside `AssetPlusViewer.tsx` but is never wired to the right panel.

**Changes to `AssetPlusViewer.tsx`:**
- Expose `showMinimap` and `setShowMinimap` via props or a custom event (like existing `ROOM_LABELS_TOGGLE_EVENT` pattern)
- Add event: `MINIMAP_TOGGLE_EVENT` dispatched from ViewerRightPanel, listened to in AssetPlusViewer

**Changes to `ViewerRightPanel.tsx`:**
- Add a "Minimap" toggle switch in the "Visa" (Display) section
- On toggle, dispatch `MINIMAP_TOGGLE_EVENT` with `{ visible: boolean }`

**Changes to `AssetPlusViewer.tsx`:**
- Listen for `MINIMAP_TOGGLE_EVENT` and update `showMinimap` state accordingly

---

### 3. Fix "Locked" Visualization Controls When Coming from Insights

**Problem:** When navigating from Insights with `insightsColorMode` and `forceXray` URL parameters, the viewer pre-configures room visualization and X-ray. But the user cannot change or override these settings afterwards.

**Root cause analysis:** The `insightsColorMode` prop is passed from UnifiedViewer as a static value from the URL parameter. The visualization effect runs in `AssetPlusViewer` and continuously re-applies when `spacesCacheReady` or `modelLoadState` changes, but the color map is consumed once from sessionStorage (it's deleted after reading). The issue is that the `XrayToggle` component manages its own local `xrayEnabled` state (default `false`), which doesn't reflect the `forceXray` initial state. Similarly, the room visualization panel doesn't know that a visualization is already active.

**Changes to `XrayToggle.tsx`:**
- Add optional `initialEnabled?: boolean` prop
- Initialize `xrayEnabled` state from this prop
- Pass `forceXray` from AssetPlusViewer through ViewerRightPanel to XrayToggle

**Changes to `AssetPlusViewer.tsx`:**
- After the insights color effect completes, clear the `insightsColorMode` state so that subsequent toggles are not blocked by the `if (!insightsColorMode) return` guard
- Add a `forceXrayInitial` state that is set from the `forceXray` prop, passed to the right panel

**Changes to `ViewerRightPanel.tsx`:**
- Pass `initialXrayEnabled` to `XrayToggle`

---

### 4. Fix Text Contrast in Modals, Menus, and Overlays

**Problem:** Dark-themed backgrounds with `text-muted-foreground` or `text-foreground/70` result in low-contrast text.

**Files to audit and fix:**
- `ViewerRightPanel.tsx`: Labels use `text-foreground/70` -- change to `text-foreground` or `text-white` where background is dark
- `ToolbarSettings.tsx`: Dialog content uses theme-based `text-muted-foreground` -- ensure sufficient contrast
- `AlignmentPanel.tsx`: Uses `text-foreground/70` on dark backgrounds -- switch to `text-white` or `text-foreground`
- `VisualizationToolbar.tsx`: Uses `bg-card/60 backdrop-blur-md` with `text-muted-foreground` -- ensure text is visible

**Approach:** Add explicit `text-white` to labels and helper text in components that render over the 3D viewer's dark background. For sheet/dialog components that use the theme's card background, ensure `text-foreground` is used consistently (not opacity-reduced variants).

---

### 5. Fix Camera Sync in Split Mode After Alignment Save

**Problem:** After point-calibrating and saving alignment in Split mode, the cameras don't follow each other.

**Root cause:** The `useViewerCameraSync` hook checks `syncLocked` before broadcasting. In Split mode, `syncLocked` starts as `false` and must be explicitly toggled by the user. The alignment save (`AlignmentPanel.handleSave`) calls `onSaved` which closes the panel but does not enable sync lock.

**Also:** The `useIvionCameraSync` hook's `moveToImageId` call (line 281) uses `ivApi.moveToImageId(...)` directly, but the NavVis SDK requires `ivApi.legacyApi.moveToImageId(...)` or `ivApi.legacyApi?.moveToImage(...)`. Similar to the `resolveMainView` fix.

**Changes to `useIvionCameraSync.ts`:**
- Add a `resolveMoveTo` helper that tries multiple SDK paths:
  ```
  ivApi.legacyApi?.moveToImageId?.(id, viewDir)
  ?? ivApi.moveToImageId?.(id, viewDir)
  ```
- Replace the direct `ivApi.moveToImageId()` call with this helper

**Changes to `UnifiedViewer.tsx` (optional UX improvement):**
- After alignment save, show a toast suggesting to enable sync lock, or auto-enable it

---

### 6. Fix Alignment Point-Picking Conflict with Select Tool

**Problem:** When clicking in 3D to pick an alignment point, the Select Object tool is active, causing the clicked object to be selected (highlighted) instead of just registering the surface point.

**Changes to `AlignmentPointPicker.tsx`:**
- When entering `picking3D` step, temporarily switch the viewer tool to `null` (deactivate select) by dispatching `VIEWER_TOOL_CHANGED_EVENT` with `tool: null`
- When the pick completes or the picker is closed, restore the previous tool

**Alternative approach (simpler):**
- The direct `xv.scene.input.on('mouseclicked')` handler already uses `xv.scene.pick({ pickSurface: true })` which returns the surface point. The issue is that the Asset+ viewer's built-in selection handler fires *before* our custom handler and selects the object. 
- Add `e.stopPropagation?.()` or use `xv.scene.input.on('mousedown')` instead to capture before the selection handler
- Or: call `assetView.useTool(null)` before entering pick mode and restore after

**Changes to `AlignmentPointPicker.tsx`:**
- On entering `picking3D`, call `window.__assetPlusViewerInstance?.assetViewer?.$refs?.assetView?.useTool(null)` to deactivate selection
- On completion or cancel, call `useTool('select')` to restore

---

### 7. Rendering Performance When Toggling Display Options

**Problem:** Toggling rooms, room visualization, etc. causes heavy rendering lag.

**Root cause:** Each toggle dispatches an event that triggers synchronous iteration over all scene objects (e.g., `setObjectsXRayed`, `setObjectsVisible`). For large models (724 rooms), this blocks the main thread.

**Changes to `XrayToggle.tsx`:**
- Use `requestIdleCallback` (or `requestAnimationFrame` batching) when applying xray to large object sets
- Process objects in batches of ~100 to avoid blocking the UI

**Changes to `AssetPlusViewer.tsx` (insights color effect):**
- The existing `requestIdleCallback` batching pattern is already used for room visualization. Verify it's also applied when toggling spaces on/off

---

### Implementation Sequence

| Priority | Task | Files |
|----------|------|-------|
| 1 | Remove duplicates from nav toolbar + add minimap to right panel | ToolbarSettings.tsx, ViewerToolbar.tsx, ViewerRightPanel.tsx, AssetPlusViewer.tsx |
| 2 | Fix Insights mode locking (XrayToggle initial state, clear insightsColorMode after apply) | XrayToggle.tsx, AssetPlusViewer.tsx, ViewerRightPanel.tsx |
| 3 | Fix camera sync SDK path (moveToImageId) | useIvionCameraSync.ts, lib/ivion-sdk.ts |
| 4 | Fix alignment pick vs select conflict | AlignmentPointPicker.tsx |
| 5 | Text contrast fixes | ViewerRightPanel.tsx, AlignmentPanel.tsx, ToolbarSettings.tsx |
| 6 | Performance batching for xray/spaces toggles | XrayToggle.tsx |

### Technical Details

**Minimap event pattern:**
```typescript
// In lib/viewer-events.ts
export const MINIMAP_TOGGLE_EVENT = 'MINIMAP_TOGGLE';

// In ViewerRightPanel.tsx
window.dispatchEvent(new CustomEvent(MINIMAP_TOGGLE_EVENT, { detail: { visible: checked } }));

// In AssetPlusViewer.tsx
useEffect(() => {
  const handler = (e: CustomEvent) => setShowMinimap(e.detail?.visible ?? false);
  window.addEventListener(MINIMAP_TOGGLE_EVENT, handler);
  return () => window.removeEventListener(MINIMAP_TOGGLE_EVENT, handler);
}, []);
```

**resolveMoveTo helper:**
```typescript
// In lib/ivion-sdk.ts
export async function resolveMoveTo(api: any, imageId: number, viewDir?: any, options?: any): Promise<void> {
  if (typeof api?.legacyApi?.moveToImageId === 'function') {
    return api.legacyApi.moveToImageId(imageId, viewDir, options);
  }
  if (typeof api?.moveToImageId === 'function') {
    return api.moveToImageId(imageId, viewDir, options);
  }
  throw new Error('moveToImageId not found on SDK');
}
```

**XrayToggle batching:**
```typescript
const BATCH_SIZE = 100;
const applyXrayBatched = (ids: string[], scene: any, xrayed: boolean) => {
  let i = 0;
  const processBatch = () => {
    const end = Math.min(i + BATCH_SIZE, ids.length);
    for (; i < end; i++) {
      const entity = scene.objects?.[ids[i]];
      if (entity) entity.xrayed = xrayed;
    }
    if (i < ids.length) requestAnimationFrame(processBatch);
  };
  requestAnimationFrame(processBatch);
};
```

