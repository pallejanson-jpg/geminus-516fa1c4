

## Plan: xeokit 2D View, Section Plane Clipping & Expandable Minimap

This plan addresses three interconnected areas: fixing section plane clipping, building a xeokit-based 2D view, and making the minimap resizable up to half the screen.

---

### 1. Fix Section Plane Clipping (Priority - unblocks everything else)

**Problem diagnosis:**
The current `useSectionPlaneClipping` hook tries three methods to create SectionPlanes:
1. SectionPlanesPlugin via `(window as any).xeokit?.SectionPlanesPlugin` -- this class is NOT exposed globally because AssetPlusViewer bundles xeokit internally in a UMD file
2. Direct `SectionPlane` constructor -- same issue, not globally available
3. Low-level `scene._sectionPlanesState` manipulation -- this is an internal API that may have changed between xeokit versions

**Root cause:** The AssetPlusViewer UMD bundle embeds xeokit but does NOT export its plugin classes to the global scope. The hook can't find `SectionPlanesPlugin` or `SectionPlane` constructors.

**Solution:**
Access SectionPlanes through the xeokit viewer instance's own scene API. The xeokit `scene` object has a built-in `SectionPlane` component system accessible via `new viewer.scene.SectionPlane(...)` or through the viewer's plugin registry.

**Technical changes:**

- **`src/hooks/useSectionPlaneClipping.ts`**: Rewrite `createSectionPlaneOnScene` to:
  1. First check `viewer.scene.components` for existing SectionPlanesPlugin instances
  2. Try `new viewer.scene.SectionPlane(scene, { id, pos, dir, active: true })` -- the SectionPlane class is attached to the scene's component factory in bundled xeokit
  3. If that fails, enumerate `viewer.scene.components` to find the SectionPlane constructor from an already-created instance's prototype
  4. Add debug logging that reports exactly which method succeeded/failed for troubleshooting

- Add a diagnostic function that logs all available scene component types to help debug what the AssetPlusViewer bundle exposes

---

### 2. xeokit-based 2D Floor Plan View

**Current state:** The minimap uses `StoreyViewsPlugin` but falls back to a simple canvas rendering from AABB data. The `StoreyViewsPlugin` class is likely also not globally available (same UMD bundling issue).

**Strategy:** Build the 2D view using xeokit's own camera capabilities rather than relying on `StoreyViewsPlugin`:
- Set camera to orthographic projection
- Position camera directly above the floor looking down
- Apply section plane clipping (from fix above) to show only one floor slab
- This gives a true interactive 2D plan view using the same 3D engine

**Technical changes:**

- **`src/components/viewer/Xeokit2DPlanView.tsx`** (new file): A component that:
  - Takes a `viewerRef` and `floorId`
  - Switches camera to `projection: "ortho"` with eye looking straight down `[centerX, height, centerZ]`, look `[centerX, 0, centerZ]`, up `[0, 0, -1]`
  - Applies floor-plan section plane clipping (top + bottom planes from the fixed hook)
  - Provides pan/zoom controls (mouse drag + scroll wheel)
  - Has a "Back to 3D" button that restores perspective camera
  - Syncs camera position indicator with 3D view when in split mode

- **Integration into UnifiedViewer**: Add this as an alternative 2D mode option alongside FM Access 2D:
  - When building has FM Access configured: show FM Access 2D (existing)
  - Always available: xeokit 2D plan view (new) -- add as "2D Plan" mode button
  - Both accessible from mode switcher

---

### 3. Expandable Minimap (Resizable up to ~50% viewport)

**Current state:** MinimapPanel toggles between 240x200 and 360x300 pixels. Fixed in top-left corner.

**Changes to `src/components/viewer/MinimapPanel.tsx`:**

- Replace fixed size toggle with a **drag-to-resize handle** (bottom-right corner)
- Add three size presets accessible via buttons:
  - Mini: 240x200 (current default)
  - Medium: ~400x350
  - Large: ~50% of viewport width and height
- The large preset effectively creates a split-screen effect with the minimap
- Make the panel draggable (move it around the viewport)
- When at large size, the canvas resolution scales up accordingly for crisp rendering
- Camera indicator on the minimap stays synced with 3D navigation
- Clicking on the minimap at any size navigates the 3D camera (already works)

---

### 4. Split Screen: 3D + xeokit 2D Side by Side

**Future extension** (can be built incrementally after items 1-3):

Once the xeokit 2D plan view works (item 2), add a split mode:
- Left panel: 3D perspective view
- Right panel: 2D orthographic plan view (same xeokit instance, second camera state stored separately)
- Camera positions synchronized: clicking in 2D moves 3D camera, and vice versa
- This reuses the same AssetPlusViewer instance, just switching camera projection per panel

**Note:** This is more complex since xeokit has one camera per viewer. The approach would be:
- Use the minimap (item 3) at large size as a "pseudo split screen" for the immediate term
- For true split screen, either render the 2D view as a canvas overlay (using `createStoreyMap` or manual rendering) or investigate if AssetPlusViewer supports multiple camera viewports

---

### Implementation Order

1. **Fix section plane clipping** -- debug what the AssetPlusViewer UMD bundle actually exposes on `viewer.scene`, then adapt the hook
2. **Expandable minimap** -- straightforward UI enhancement, works with current fallback rendering
3. **xeokit 2D plan view** -- depends on working section planes for proper floor isolation
4. **Split screen 3D+2D** -- depends on 2D plan view working

---

### Technical Details

**Diagnosing the xeokit bundle:**
Add a temporary diagnostic that runs after viewer init:
```typescript
const viewer = getXeokitViewer();
console.log('Scene components:', Object.keys(viewer.scene.components || {}));
console.log('Scene types:', [...new Set(Object.values(viewer.scene.components || {}).map((c: any) => c.constructor?.name))]);
console.log('Viewer plugins:', Object.keys(viewer.plugins || {}));
console.log('SectionPlane class available:', !!viewer.scene.SectionPlane);
```

This will tell us exactly what's available and guide the clipping fix.

**Camera switch for 2D plan view:**
```typescript
// Save 3D state
const savedEye = [...camera.eye];
const savedLook = [...camera.look];
const savedProjection = camera.projection;

// Switch to 2D orthographic top-down
camera.projection = "ortho";
camera.eye = [centerX, floorMaxY + 50, centerZ];
camera.look = [centerX, floorMinY, centerZ];
camera.up = [0, 0, -1];
```

**Minimap resize handle:**
Use a mouse-down/move/up pattern on a small corner grip element. Constrain minimum size to 200x160 and maximum to `window.innerWidth * 0.5` by `window.innerHeight * 0.5`.

