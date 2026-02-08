

# Virtual Twin: 360-degree + 3D Overlay Implementation

## Overview

A new viewing mode where the 3D BIM model is rendered as a semi-transparent overlay on top of the live 360-degree panorama. The user navigates panoramas in 360-degree as usual, while the BIM geometry is ghosted on top, providing a "digital twin" visualization that merges real-world imagery with the BIM model.

This feature reuses the existing Asset+ viewer and Ivion SDK components with minimal new infrastructure, and the Ivion-to-BIM coordinate transform it introduces will also fix the existing Split View camera sync issues.

---

## Architecture

The Virtual Twin page layers two existing components:

```text
+--------------------------------------------------+
| Header: [Back] [Building Name]  [Align] [Ghost]  |
+--------------------------------------------------+
|                                                    |
|  z-index: 0  -- Ivion SDK <div> (360-degree)       |
|    - Full viewport, receives all pointer events    |
|    - User navigates panorama naturally             |
|                                                    |
|  z-index: 10 -- Asset+ 3D <canvas>                |
|    - Transparent background (CSS)                  |
|    - pointer-events: none                          |
|    - All objects at 30% opacity ("ghost mode")     |
|    - Camera locked to Ivion camera pose            |
|                                                    |
+--------------------------------------------------+
| Alignment Panel (slide-out, when activated)        |
| [Offset X] [Offset Y] [Offset Z] [Rotation]       |
| [Save]  [Reset]                                    |
+--------------------------------------------------+
```

Camera sync is one-directional: Ivion drives, 3D follows. The sync loop runs via polling (same as the existing `useIvionCameraSync` hook) but writes directly to the xeokit camera without going through the `ViewerSyncContext`.

---

## Phase 1: Ivion-to-BIM Transform

**The core problem:** Ivion SDK reports positions in its own local coordinate space (meters relative to site origin). The BIM model (xeokit) uses its own local coordinate space. These are not the same. Currently the sync code passes Ivion coordinates straight to xeokit, which is why Split View cameras don't follow each other correctly.

**Solution:** Store a per-building offset + rotation that maps Ivion space to BIM space.

### New file: `src/lib/ivion-bim-transform.ts`

```text
Interface IvionBimTransform {
  offsetX: number;  // meters
  offsetY: number;  // meters
  offsetZ: number;  // meters
  rotation: number; // degrees
}

function ivionToBim(pos, transform) -> { x, y, z }
function bimToIvion(pos, transform) -> { x, y, z }
function ivionHeadingToBim(heading, transform) -> heading
function bimHeadingToIvion(heading, transform) -> heading
```

The transform applies: (1) rotation around Y axis by `transform.rotation`, then (2) translation by offsets.

### Database migration

Add four columns to `building_settings`:
- `ivion_bim_offset_x` numeric DEFAULT 0
- `ivion_bim_offset_y` numeric DEFAULT 0
- `ivion_bim_offset_z` numeric DEFAULT 0
- `ivion_bim_rotation` numeric DEFAULT 0

---

## Phase 2: Virtual Twin Page

### New file: `src/pages/VirtualTwin.tsx`

Route: `/virtual-twin?building=<fmGuid>`

**Data loading** (reuses SplitViewer pattern):
- Reads `building` param from URL
- Finds building in `allData`
- Fetches `building_settings` for ivion_site_id + alignment offsets
- If no ivion_site_id configured, shows error with "Back" button

**Layout:**
- Full viewport, two stacked layers
- Bottom layer: SDK container `<div>` with Ivion SDK loaded exactly as in `Ivion360View` (reuse `loadIvionSdk`, `createIvionElement`, `fetchLoginToken`)
- Top layer: Asset+ viewer `<div id="AssetPlusVirtualTwin">` with CSS overrides:
  - `pointer-events: none` on the wrapper
  - Background gradient replaced with `transparent`
  - Canvas background set via CSS to transparent

**Transparent 3D canvas approach:**

The Asset+ viewer creates a xeokit instance internally. After initialization, we access the xeokit canvas:
```text
const xeokitViewer = viewerInstance.$refs.AssetViewer.$refs.assetView.viewer;
const canvas = xeokitViewer.scene.canvas.canvas;
canvas.style.background = 'transparent';
```

The Asset+ viewer container background gradient (line 2819 of AssetPlusViewer.tsx) is set via inline style. For Virtual Twin, we use a new prop `transparentBackground` that omits this gradient.

**Ghost mode:**

After models load, apply reduced opacity to all objects:
```text
const objectIds = xeokitViewer.scene.objectIds;
xeokitViewer.scene.setObjectsOpacity(objectIds, 0.3);
```

This makes geometry semi-transparent so the panorama shows through.

**Camera sync loop:**

A `useEffect` that polls the Ivion SDK every 100ms:
```text
1. const image = ivApi.getMainView().getImage()
2. if (!image) return
3. const viewDir = ivApi.getMainView().currViewingDir
4. Apply ivionToBim transform to image.location
5. Set xeokitCamera.eye = transformedPosition
6. Set xeokitCamera.look = calculated from heading/pitch
7. Set xeokitCamera.perspective.fov = 90 (match panorama)
```

This runs in `requestAnimationFrame` for smooth tracking.

**Header toolbar:**
- Back button (navigate(-1))
- Building name
- Ghost opacity slider (0-100%, default 30%)
- Alignment mode toggle button
- Fullscreen toggle

### New file: `src/hooks/useVirtualTwinSync.ts`

Dedicated hook for one-directional Ivion-to-3D sync:
- Takes `ivApiRef`, `viewerInstanceRef`, `transform` (IvionBimTransform)
- Polls Ivion SDK position at 60fps via requestAnimationFrame
- Directly sets xeokit camera (no ViewerSyncContext needed)
- Returns `{ isActive, currentImageId }`

---

## Phase 3: Alignment Panel

### New file: `src/components/viewer/AlignmentPanel.tsx`

A slide-out panel for calibrating the Ivion-to-BIM transform:

**Controls:**
- Offset X slider: -50m to +50m, step 0.01m
- Offset Y slider: -50m to +50m, step 0.01m
- Offset Z slider: -50m to +50m, step 0.01m
- Rotation slider: -180deg to +180deg, step 0.1deg
- "Save" button: upserts to `building_settings`
- "Reset" button: set all to 0

**Live preview:** Adjusting any slider immediately updates the transform used by the sync loop, so the user sees the BIM model shift in real-time relative to the panorama.

**Styling:** Dark semi-transparent panel (matches viewer overlay aesthetic), positioned on the left side.

---

## Phase 4: Apply Transform to Split View

The same `ivionToBim` / `bimToIvion` functions fix the existing Split View sync.

### Modified: `src/hooks/useIvionCameraSync.ts`

In the SDK polling loop (lines 179-216), apply the transform:

```text
// BEFORE (current - broken):
const pos = { x: image.location.x, y: image.location.y, z: image.location.z };
updateFromIvion(pos, heading, pitch);

// AFTER (with transform):
const bimPos = ivionToBim(image.location, buildingTransform);
const bimHeading = ivionHeadingToBim(heading, buildingTransform);
updateFromIvion(bimPos, bimHeading, pitch);
```

In the 3D-to-360 direction (`syncToIvionSdk`, lines 246-290), apply inverse transform when finding nearest image:

```text
// When comparing positions, transform the 3D position to Ivion space first
const ivionPos = bimToIvion(syncState.position, buildingTransform);
const nearestImage = findNearestImage(ivionPos);
```

Also transform heading when setting viewDir for `moveToImageId()`.

### Modified: `src/hooks/useIvionCameraSync.ts` (interface)

Add `buildingTransform?: IvionBimTransform` to `UseIvionCameraSyncOptions`.

### Modified: `src/components/viewer/Ivion360View.tsx`

Fetch `ivion_bim_offset_x/y/z` and `ivion_bim_rotation` from building_settings and pass to the sync hook.

### Modified: `src/pages/SplitViewer.tsx`

Fetch the new alignment columns and pass them through to both viewers.

---

## Phase 5: AssetPlusViewer - transparentBackground Prop

### Modified: `src/components/viewer/AssetPlusViewer.tsx`

Add optional prop `transparentBackground?: boolean`:
- When true, omit the radial gradient background style on the container div (line 2819)
- After viewer initialization, set `canvas.style.background = 'transparent'`
- Disable NavCube, toolbar, floor switcher, and other UI overlays
- After all models load, apply ghost opacity to all objects

This keeps the existing AssetPlusViewer fully functional for normal use while enabling overlay mode for Virtual Twin.

---

## Phase 6: Route and Navigation

### Modified: `src/App.tsx`

Add Virtual Twin route:
```text
<Route
  path="/virtual-twin"
  element={
    <Suspense fallback={...}>
      <ProtectedRoute>
        <VirtualTwin />
      </ProtectedRoute>
    </Suspense>
  }
/>
```

### Modified: `src/components/portfolio/QuickActions.tsx`

Add "Virtual Twin" as a quick action alongside existing "Split View":
- Icon: Layers or similar
- Navigates to `/virtual-twin?building=<fmGuid>`
- Only shows when building has Ivion site ID configured

### Modified: `src/components/portfolio/FacilityLandingPage.tsx`

Add "Virtual Twin" button near the existing "Split View" launch.

---

## File Summary

| File | Type | Description |
|---|---|---|
| `src/lib/ivion-bim-transform.ts` | New | Transform functions between Ivion and BIM coordinate spaces |
| `src/pages/VirtualTwin.tsx` | New | Main Virtual Twin page with layered 360+3D viewers |
| `src/hooks/useVirtualTwinSync.ts` | New | One-directional Ivion-to-3D camera sync hook |
| `src/components/viewer/AlignmentPanel.tsx` | New | Calibration UI for coordinate alignment |
| `src/components/viewer/AssetPlusViewer.tsx` | Modified | Add `transparentBackground` prop for overlay mode |
| `src/hooks/useIvionCameraSync.ts` | Modified | Apply ivion-to-BIM transform in sync loop |
| `src/pages/SplitViewer.tsx` | Modified | Fetch and pass alignment data for improved sync |
| `src/components/viewer/Ivion360View.tsx` | Modified | Pass transform data to sync hook |
| `src/App.tsx` | Modified | Add `/virtual-twin` route |
| `src/components/portfolio/QuickActions.tsx` | Modified | Add Virtual Twin navigation entry |
| `src/components/portfolio/FacilityLandingPage.tsx` | Modified | Add Virtual Twin launch button |
| Database migration | New | Add ivion_bim_offset_x/y/z and ivion_bim_rotation to building_settings |

## Technical Risks

- **Canvas transparency:** The Asset+ UMD bundle wraps xeokit and may set its own canvas background. After initialization we can override it via DOM access. If the UMD resets it, we fall back to CSS `mix-blend-mode: multiply` on the 3D layer.
- **FOV matching:** The panorama's FOV must match xeokit's perspective camera FOV. The Ivion SDK may not expose FOV directly -- we default to 90 degrees and allow fine-tuning via the alignment panel.
- **Performance:** Running both viewers simultaneously is memory-intensive. On mobile, the Virtual Twin option will be hidden or show a warning.
- **Two Asset+ instances:** Having Asset+ viewer in both normal mode and Virtual Twin mode on different pages is fine since they're never active simultaneously (different routes).
- **Alignment persistence:** The offsets are stored per building in the database, so once calibrated they persist across sessions and users.

