
# Apply Ivion-to-BIM Transform to Split View Camera Sync

## Problem

The Split View (`SplitViewer.tsx`) currently passes Ivion positions directly to the `ViewerSyncContext` without any coordinate transformation. When the Ivion SDK reports a panorama position like `{x: 42, y: 1.6, z: -18}`, that position goes straight into `updateFromIvion()` and then into the 3D viewer's `camera.eye` -- but Ivion coordinates and BIM coordinates use different coordinate systems (different origins, potentially different rotations). This causes the 3D camera to point at the wrong location.

The `ivion-bim-transform.ts` module and the database columns (`ivion_bim_offset_x/y/z`, `ivion_bim_rotation`) already exist from the Virtual Twin implementation. We just need to wire them into the Split View flow.

## Changes

### 1. `src/hooks/useIvionCameraSync.ts` -- Apply transform in both sync directions

**Interface change:** Add `buildingTransform?: IvionBimTransform` to `UseIvionCameraSyncOptions`.

**360-degree to 3D direction** (SDK polling loop, lines 179-216):
- Import `ivionToBim`, `ivionHeadingToBim`, `bimToIvion`, `bimHeadingToIvion` from `ivion-bim-transform.ts`
- After reading `image.location` and computing heading, apply `ivionToBim()` to position and `ivionHeadingToBim()` to heading before calling `updateFromIvion()`
- Same transform applied in `syncFrom360Url` (manual URL sync)

**3D to 360-degree direction** (syncToIvionSdk, lines 246-290):
- Before calling `findNearestImage()`, apply `bimToIvion()` to convert the 3D sync position back to Ivion space (since the image cache stores Ivion-space positions)
- Apply `bimHeadingToIvion()` to heading when constructing the `viewDir` for `moveToImageId()`

**3D to 360-degree iframe fallback** (syncToIvionIframe, lines 295-320):
- Same inverse transform before `findNearestImage()` and when constructing vlon/vlat

### 2. `src/pages/SplitViewer.tsx` -- Fetch transform data and pass it through

**Data loading** (lines 498-503): Expand the `building_settings` query to also fetch `ivion_bim_offset_x`, `ivion_bim_offset_y`, `ivion_bim_offset_z`, `ivion_bim_rotation`.

**BuildingData interface**: Add `ivionBimTransform?: IvionBimTransform` field.

**Pass to Ivion360View**: Add a new prop `ivionBimTransform` on the `Ivion360View` component for forwarding to `useIvionCameraSync`.

### 3. `src/components/viewer/Ivion360View.tsx` -- Accept and forward transform

**Props**: Add `ivionBimTransform?: IvionBimTransform` to `Ivion360ViewProps`.

**Pass to hook**: Forward the transform to `useIvionCameraSync()` as `buildingTransform`.

### 4. `src/hooks/useViewerCameraSync.ts` -- No changes needed

This hook operates entirely in BIM space. The `syncState.position` it receives from `ViewerSyncContext` will already be in BIM coordinates (because `useIvionCameraSync` now transforms before writing to the context). The 3D camera positions it broadcasts are also in BIM coordinates. No transform needed here.

## Data Flow After Changes

```text
360-degree to 3D:
  Ivion SDK image.location (Ivion space)
    --> ivionToBim(pos, transform)  [NEW]
    --> ivionHeadingToBim(heading, transform)  [NEW]
    --> updateFromIvion(bimPos, bimHeading, pitch)
    --> ViewerSyncContext
    --> useViewerCameraSync sets camera.eye/look (BIM space)

3D to 360-degree:
  xeokit camera.eye (BIM space)
    --> updateFrom3D(bimPos, bimHeading, bimPitch)
    --> ViewerSyncContext
    --> bimToIvion(pos, transform)  [NEW]
    --> bimHeadingToIvion(heading, transform)  [NEW]
    --> findNearestImage(ivionPos) + moveToImageId(viewDir)
```

## File Summary

| File | Changes |
|---|---|
| `src/hooks/useIvionCameraSync.ts` | Add `buildingTransform` prop, apply `ivionToBim`/`bimToIvion` in both sync directions |
| `src/pages/SplitViewer.tsx` | Fetch `ivion_bim_offset_x/y/z` and `ivion_bim_rotation` from DB, pass as transform to Ivion360View |
| `src/components/viewer/Ivion360View.tsx` | Accept `ivionBimTransform` prop and forward to `useIvionCameraSync` |

## Risk Assessment

- **Low risk**: The transform defaults to identity (all zeros) when no calibration has been configured, so buildings without alignment data behave exactly as before.
- **No breaking changes**: The new `buildingTransform` prop is optional with a fallback to `IDENTITY_TRANSFORM`.
- **Shared with Virtual Twin**: The same `ivion-bim-transform.ts` module is already validated in the Virtual Twin implementation.
