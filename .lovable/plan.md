

# Fix SDK Timeout and Add Point-Pick Alignment in Split Mode

## 1. SDK Timeout Fix

### Problem
The Ivion SDK consistently times out after 30 seconds. Logs show:
- Token is fetched successfully
- Local SDK loads fine
- `<ivion>` element has dimensions
- `getApi()` is called but never resolves within 30s
- Concurrent load guard causes cascading failures when the component remounts

### Root Causes
1. The timeout was reduced from 45s to 30s in an earlier change (`useIvionSdk.ts` line 100 passes `30000`). The SDK initialization can legitimately take 30-40s on slower connections.
2. When the SDK fails and `useIvionSdk` sets status to `'failed'`, the `useEffect` in `UnifiedViewer` (line 83-88) forces `viewMode` to `'3d'`, which sets `sdkNeeded` to `false`, which sets `enabled` to `false` in `useIvionSdk`. The cleanup runs, destroying the `<ivion>` element. When the user retries or switches mode, a fresh load starts but the old `activeLoadPromise` module-level guard may still be set from the timed-out promise, causing "Another load is in progress" delays.

### Fix
- **`useIvionSdk.ts`**: Restore timeout to 45 seconds (change `30000` to `45000` on the `loadIvionSdk` call).
- **`ivion-sdk.ts`**: After a timeout, explicitly clear `activeLoadPromise` so retries don't wait on a dead promise. The current code does this in the `finally` block, but the `Promise.race` timeout rejection leaves the original `apiPromise` still pending forever -- subsequent calls see `activeLoadPromise` as non-null and wait for it.
- **`ivion-sdk.ts`**: Add a forced cleanup of `activeLoadPromise` when timeout fires, so concurrent guard doesn't block retries.

## 2. Point-Pick Alignment Workflow (Split Mode)

### Current Problem
Manual slider alignment is difficult because the user has no reference points to anchor the transform. The offsets and rotation feel arbitrary.

### Solution: Two-Point Calibration
In Split mode, the user picks a recognizable point (e.g., a door corner, column) in the 360 view, then picks the same point in the 3D view. The system calculates the translation offset automatically. For rotation, a second pair of points is needed, or the user can fine-tune rotation manually after translation is locked.

### Workflow
1. User opens Alignment panel in Split mode
2. Clicks "Pick Points" button -- enters calibration mode
3. **Step 1**: Clicks a point in the 360 view (right panel). The Ivion SDK provides `mainView.getImage().location` as the Ivion-space coordinate of the current panorama position. A visual marker appears.
4. **Step 2**: Clicks a point in the 3D view (left panel). xeokit's pick result gives the BIM-space coordinate. A visual marker appears.
5. System calculates offset: `offset = bimPoint - rotate(ivionPoint, currentRotation)`
6. Values are applied to the AlignmentPanel sliders in real-time
7. User can repeat for refinement or adjust rotation manually
8. Optional: With two point pairs, rotation can be auto-calculated

### Technical Implementation

**New component: `src/components/viewer/AlignmentPointPicker.tsx`**
- Manages the two-step picking state machine: `idle` -> `picking360` -> `picking3D` -> `done`
- In `picking360` state: reads current Ivion position from SDK when user clicks a "Capture 360 Position" button (uses the panorama camera position, not a surface pick -- simpler and more reliable)
- In `picking3D` state: listens for xeokit pick events to get BIM coordinates
- Calculates transform: given Ivion point P_iv and BIM point P_bim, with current rotation R:
  ```
  rotated = rotate(P_iv, R)
  offsetX = P_bim.x - rotated.x
  offsetY = P_bim.y - rotated.y  
  offsetZ = P_bim.z - rotated.z
  ```
- Passes calculated transform back to AlignmentPanel via callback

**Modified: `src/components/viewer/AlignmentPanel.tsx`**
- Add "Pick Points" button that activates the point-picker mode
- Display picked coordinates for verification
- Auto-populate offset fields when calculation completes

**Modified: `src/pages/UnifiedViewer.tsx`**
- Pass `ivApiRef` and `viewerInstanceRef` to AlignmentPanel when in split mode so the picker can access both SDKs
- Handle pick-mode state to temporarily disable normal click behavior in 3D viewer

### UI in AlignmentPanel
```
+----------------------------------+
| Alignment               [Reset][Save] |
|                                  |
| [Pick Points]  (or manual sliders)  |
|                                  |
| Step 1: Click position in 360   |
|   360: (x, y, z) [checkmark]    |
| Step 2: Click same point in 3D  |
|   3D:  (x, y, z) [checkmark]    |
|                                  |
| [Apply Offset]  [Cancel]        |
|                                  |
| --- Manual sliders below ---    |
+----------------------------------+
```

## Files to Modify

| File | Changes |
|---|---|
| `src/hooks/useIvionSdk.ts` | Restore timeout to 45s |
| `src/lib/ivion-sdk.ts` | Force-clear `activeLoadPromise` on timeout to prevent stale guard blocking retries |
| `src/components/viewer/AlignmentPointPicker.tsx` | **New** -- Point-picking state machine for two-point calibration |
| `src/components/viewer/AlignmentPanel.tsx` | Add "Pick Points" button, display picked coords, auto-populate offsets |
| `src/pages/UnifiedViewer.tsx` | Pass `ivApiRef` and `viewerInstanceRef` to AlignmentPanel for point-picking access |

