

# Fix: Fullscreen mobile, floor selector, 2D→3D camera sync

## Problem Analysis

### 1. Fullscreen mobile not working for all modes
The `MobileUnifiedViewer` root div uses `fixed inset-0` with `height: 100dvh` — this IS fullscreen. But the non-split modes (line 993) use `absolute inset-0` inside it, which should also be fine. The issue is likely that the `NativeViewerShell` or its parent has padding/margins or that the back-button overlay gradient bar at the top (lines 1039-1045) creates visual black edges. Need to verify `NativeViewerShell` gets `h-full` in non-split mode.

### 2. Floor selector showing wrong names
The `pluginFloors` fallback (line 74) uses `storey.storeyId` as the name — these are internal xeokit IDs (often GUIDs), hence "konstiga våningsplannamn". When `useFloorData` returns empty (timing issue), the fallback shows raw IDs. Fix: use the `floors` from `useFloorData` with the DB name resolution, and for the fallback, extract a cleaner name from the metaObject hierarchy.

### 3. Camera 2D→3D completely wrong
**Root cause identified**: The `handleClick` function (line 667) computes `headUnit` from the CURRENT camera direction. On first click, the camera might be outside the building looking at an angle, so the new eye position is computed as `newLook - headUnit * viewDist` with `safeYOffset` of 2-20m — this places the eye far away from the building.

**Compare with working MinimapPanel** (line 238-246): MinimapPanel simply does:
```
eye: [worldPos[0], viewer.camera.eye[1], worldPos[2]]
look: [worldPos[0], worldPos[1], worldPos[2]]
```
This keeps eye directly ABOVE the look point at the current camera height — simple and correct.

The SplitPlanView tries to preserve heading, which puts the camera at a distance from the clicked point. This is wrong for a top-down 2D plan view.

## Plan

### File 1: `src/components/viewer/SplitPlanView.tsx`

**A) Fix handleClick — copy MinimapPanel's proven approach:**
Replace the complex heading-preserving logic (lines 686-743) with:
```typescript
const worldPos = plugin.storeyMapToWorldPos(map, [imgX, imgY]);
if (worldPos && viewer.cameraFlight) {
  viewer.cameraFlight.flyTo({
    eye: [worldPos[0], viewer.camera.eye[1], worldPos[2]],
    look: [worldPos[0], worldPos[1], worldPos[2]],
    up: [0, 1, 0],
    duration: 0.5,
  });
}
```
Keep the fallback path for when plugin is unavailable.

**B) Fix floor selector names:**
Change `pluginFloors` (line 74) to resolve names from the viewer metaScene:
```typescript
const pluginFloors = useMemo(() => {
  const plugin = pluginRef.current;
  const viewer = getXeokitViewer();
  if (!plugin?.storeys) return [];
  return Object.entries(plugin.storeys).map(([id, storey]: [string, any]) => {
    const mo = viewer?.metaScene?.metaObjects?.[id];
    const rawName = mo?.name || storey.storeyId || id;
    // Clean GUID-like names
    const name = rawName.match(/^[0-9A-Fa-f-]{30,}$/) ? `Plan` : rawName;
    const shortMatch = name.match(/(\d+)/);
    const shortName = shortMatch ? shortMatch[1] : name.substring(0, 10);
    return { id, name, shortName };
  });
}, [storeyPlugin]);
```

Also display `f.name` instead of `f.shortName` in the Select dropdown for clarity.

**C) Fix camera marker — match MinimapPanel's approach using `camera.eye`:**
The MinimapPanel (line 212) uses `eye` for marker position, not `look`. The SplitPlanView uses `look` (line 506). Since the user is navigating from a top-down 2D view, using `eye` is more intuitive (shows where you are, not where you're looking). Change to use `eye` like MinimapPanel.

### File 2: `src/pages/UnifiedViewer.tsx`

**D) Fullscreen for all modes:**
The non-split container (line 993 `<div className="absolute inset-0">`) needs to ensure the NativeViewerShell fills it completely. Add explicit `h-full w-full` and ensure no extra padding. The mode-switcher overlay should use `pointer-events-none` on its container with `pointer-events-auto` only on buttons, to avoid blocking the viewer canvas.

## Files to change
1. `src/components/viewer/SplitPlanView.tsx` — camera click, floor names, marker
2. `src/pages/UnifiedViewer.tsx` — fullscreen layout for all mobile modes

