
# Plan: Fix Visualization, 2D Clipping, Toolbar Settings & Screenshot Capture

## Issues Identified

### 1. Room Visualization Not Coloring Rooms
**Root Cause:** The `applyVisualization` function in `RoomVisualizationPanel.tsx` has a dependency issue in its `useEffect`:
- Lines 389-393 show dependencies as `[visualizationType, useMockData, entityIdCache.size]`
- But `applyVisualization` is called directly, which can be stale due to React's closure behavior
- When visualization type changes, the function may reference outdated state

**Fix:**
- Change the useEffect to directly inline the visualization logic OR use `applyVisualization` with proper dependencies
- Add `rooms.length` as a key dependency
- Ensure `entityIdCache.size > 0` guard is properly checking fresh cache

### 2. 2D/3D Toggle Naming and Clipping Not Working
**Current Issues:**
- Label says "2D planvy" instead of "2D/3D" (line ~555 in VisualizationToolbar)
- Clip height slider dispatches `CLIP_HEIGHT_CHANGED_EVENT` (lines 157-164)
- ViewerToolbar listens but `updateFloorCutHeight` only re-applies if `currentFloorIdRef.current && currentClipModeRef.current === 'floor'` (lines 253-260 in useSectionPlaneClipping)
- The `currentFloorIdRef` is null when no specific floor is selected, so clipping never applies

**Fix:**
- Rename "2D planvy" to "2D/3D"
- When entering 2D mode without a specific floor selected, use the scene's first floor or apply global clipping at clip height
- Modify `handleViewModeChange` in ViewerToolbar to always apply clipping in 2D mode, even if no specific floor is selected

### 3. Toolbar Customization Changes Not Reflected Immediately
**Root Cause:** In `ToolbarSettings.tsx`, the `saveToolbarSettings` function (line 142-150) dispatches `TOOLBAR_SETTINGS_CHANGED_EVENT`. 
- `ViewerToolbar.tsx` listens on lines 100-112 and calls `setToolSettings(getNavigationToolSettings())`
- This should work, but the issue may be that the toolbar rendering uses `getOrderedMainTools()` which depends on `toolSettings` state

**Potential Issue:** The settings are saved correctly but the UI re-render may not be triggering because the reference equality check on `toolSettings` array doesn't detect changes.

**Fix:**
- Increment a version counter when settings change to force re-render
- OR ensure the event handler creates a new array reference

### 4. "Skapa Vy" (Create View) Error - Wrong Screenshot Method
**Console Error:** `TypeError: xeokitViewer.getImage is not a function`

**Root Cause:** In `VisualizationToolbar.tsx` lines 187-192, we call:
```javascript
const screenshotDataUrl = xeokitViewer.getImage({...})
```
But xeokit viewer doesn't have a `getImage()` method. The correct approach is to access the canvas directly.

**Fix:** Use the canvas's `toDataURL()` method:
```typescript
const canvas = xeokitViewer.scene.canvas.canvas; // The actual HTML canvas element
const screenshotDataUrl = canvas.toDataURL('image/png');
```

---

## Detailed Changes

### File 1: `src/components/viewer/RoomVisualizationPanel.tsx`

**Problem:** Auto-apply not triggering room coloring

**Changes:**
1. Fix the auto-apply useEffect to properly trigger visualization:
```typescript
// Line ~389-393: Improve dependency tracking
useEffect(() => {
  // Only apply if we have rooms, cache, and a type selected
  if (visualizationType !== 'none' && rooms.length > 0 && entityIdCache.size > 0) {
    // Reset colorized count before re-applying
    setColorizedCount(0);
    applyVisualization();
  } else if (visualizationType === 'none') {
    resetColors();
  }
}, [visualizationType, useMockData, rooms.length, entityIdCache.size]);
```

2. Ensure `applyVisualization` is properly memoized and doesn't have stale closures - the current implementation references `rooms` which may be stale.

---

### File 2: `src/components/viewer/VisualizationToolbar.tsx`

**Changes:**

1. **Rename label** (around line 555):
```typescript
// Change from "2D planvy" to "2D/3D"
<Label htmlFor="2d-mode-switch" className="text-sm">2D/3D</Label>
```

2. **Fix screenshot capture** (lines 187-192):
```typescript
// OLD (broken):
const screenshotDataUrl = xeokitViewer.getImage({...});

// NEW (working):
const canvas = xeokitViewer.scene?.canvas?.canvas;
if (!canvas) {
  toast({ title: "Kan inte skapa vy", description: "Canvas inte tillgängligt", variant: "destructive" });
  return;
}
// Force a render before capturing
xeokitViewer.scene?.render?.(true);
const screenshotDataUrl = canvas.toDataURL('image/png');
```

---

### File 3: `src/components/viewer/ViewerToolbar.tsx`

**Changes:**

1. **Fix 2D clipping to work without specific floor selected** (in `handleViewModeChange`, around line 324):

When entering 2D mode and no floor is selected:
- Get scene AABB (bounding box)
- Calculate a reasonable clip height (e.g., minY + clipHeight where clipHeight = 1.2m)
- Create section plane at that height

```typescript
if (mode === '2d') {
  // ... existing camera setup ...
  
  // Apply clipping even without specific floor
  if (currentFloorId) {
    applyFloorPlanClipping(currentFloorId);
  } else {
    // No specific floor - apply global clipping at base + height
    const scene = viewer.scene;
    const sceneAABB = scene?.getAABB?.();
    if (sceneAABB) {
      const baseHeight = sceneAABB[1]; // minY
      // Create a synthetic floor for global clipping
      applyGlobalFloorPlanClipping(baseHeight);
    }
  }
}
```

2. **Add listener dependency fix** (line 210):
Currently `handleViewModeChange` is not in the dependency array of the VIEW_MODE_REQUESTED_EVENT listener, causing stale closure.

---

### File 4: `src/hooks/useSectionPlaneClipping.ts`

**Changes:**

Add a new function `applyGlobalClipping` that doesn't require a floor ID:
```typescript
const applyGlobalClipping = useCallback((baseHeight: number, customHeight?: number) => {
  const viewer = getXeokitViewer();
  if (!viewer?.scene) return;
  
  const height = customHeight ?? floorCutHeightRef.current;
  const clipY = baseHeight + height;
  
  // Remove existing plane
  if (sectionPlaneRef.current?.destroy) {
    sectionPlaneRef.current.destroy();
  }
  
  // Create new plane
  const plugin = initializeSectionPlanesPlugin();
  if (plugin) {
    sectionPlaneRef.current = plugin.createSectionPlane({
      id: 'global-floor-clip',
      pos: [0, clipY, 0],
      dir: [0, -1, 0],
      active: true,
    });
    currentClipModeRef.current = 'floor';
  }
}, [getXeokitViewer, initializeSectionPlanesPlugin]);
```

---

### File 5: `src/components/viewer/ToolbarSettings.tsx`

**Verify settings dispatch works correctly:**

The current implementation looks correct. The issue may be in how ViewerToolbar receives the event.

In ViewerToolbar, ensure the event handler forces a fresh state update:
```typescript
const handleSettingsChange = () => {
  const newSettings = getNavigationToolSettings();
  setToolSettings([...newSettings]); // Create new array reference
};
```

---

## Summary of Root Causes

| Issue | Root Cause | Fix |
|-------|------------|-----|
| Room visualization not coloring | useEffect dependencies don't trigger re-apply properly; possibly stale closure on `rooms` | Restructure useEffect with proper dependencies |
| 2D/3D label wrong | Hardcoded "2D planvy" string | Change to "2D/3D" |
| Clip height slider no effect | Clipping only applies if a specific floor is selected | Add global clipping fallback when no floor selected |
| Toolbar changes not immediate | Possibly stale array reference | Force new array on settings change |
| Screenshot error | Wrong API method (`getImage` doesn't exist) | Use `canvas.toDataURL()` instead |

---

## Testing Checklist

1. **Room Visualization:**
   - Open viewer with building
   - Open Room Visualization panel
   - Select "Temperatur" from dropdown
   - Verify rooms get colored immediately (no "Uppdatera" button needed)
   - Switch to "CO2" - verify colors change automatically

2. **2D/3D Mode:**
   - Verify label shows "2D/3D" not "2D planvy"
   - Toggle to 2D mode
   - Move clip height slider
   - Verify the section plane cuts at different heights
   - Return to 3D mode - verify clipping is removed

3. **Toolbar Customization:**
   - Open "Anpassa verktygsfält"
   - Toggle off a tool (e.g., "Mätverktyg")
   - Click Save
   - Verify tool disappears from bottom toolbar immediately

4. **Create View:**
   - Click "Skapa Vy" in display menu
   - Verify dialog opens with screenshot preview
   - Enter name and save
   - Verify view appears in saved views list

