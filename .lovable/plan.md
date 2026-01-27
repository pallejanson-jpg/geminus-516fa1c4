
# Plan: Fix 3D Viewer Toolbars - Right Overflow Menu and Bottom Navigation

## Problem Summary

Two critical toolbar issues in the 3D viewer:

1. **Right Overflow Menu (VisualizationToolbar)**: Opens but shows no content - only "Vy-alternativ" heading visible
2. **Bottom Navigation Toolbar (ViewerToolbar)**: All buttons work sporadically/unreliably

## Root Cause Analysis

### Issue 1: VisualizationToolbar Content Not Rendering

The Sheet component opens correctly, but content sections are conditionally rendered based on data that fails to load:

| Section | Condition | Data Source | Status |
|---------|-----------|-------------|--------|
| BIM Models | `availableModels.length > 0` | `viewerRef.current?.$refs?.AssetViewer?.availableModels` | Fails - wrong ref path |
| Floors | `availableFloors.length > 0` | XEOKit metaScene `IfcBuildingStorey` objects | May not be ready |
| Tree View | `onToggleTreeView && localTreeView` | Parent prop | Works if prop passed |
| Visualization | `onToggleVisualization && localVisualization` | Parent prop | Works if prop passed |

The core problem: The ref access pattern `viewerRef.current?.$refs?.AssetViewer` is incorrect. The Asset+ viewer instance is stored directly in `viewerInstanceRef.current`, not nested under `$refs.AssetViewer`.

**Correct patterns:**
- Direct API: `viewerRef.current?.assetViewer` (for high-level methods)
- XEOKit access: `viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer` (for XEOKit engine)

### Issue 2: ViewerToolbar Buttons Sporadic

The `getAssetView()` helper returns `undefined` intermittently because:
1. The Vue `$refs` chain isn't stable during viewer state transitions
2. No readiness checks before executing tool commands
3. Tool state can get "stuck" when commands fail silently

## Technical Solution

### Part A: Fix VisualizationToolbar Content Loading

**File: `src/components/viewer/VisualizationToolbar.tsx`**

1. **Fix BIM models data source** (lines 204-215):
   - Change from `viewer?.$refs?.AssetViewer?.availableModels` 
   - To: Query XEOKit `metaScene.metaModels` for loaded model IDs
   
2. **Add fallback content when no models/floors found**:
   - Show informative message instead of empty space
   - Ensure basic view toggles always render

3. **Improve viewer readiness check**:
   - Add `isViewerReady` derived state
   - Show loading indicator until viewer is fully initialized

4. **Fix inconsistent ref access patterns**:
   - Standardize on documented patterns from AssetPlusViewer

### Part B: Fix ViewerToolbar Reliability

**File: `src/components/viewer/ViewerToolbar.tsx`**

1. **Add viewer readiness guard**:
   - Create `isViewerReady` state that tracks when viewer is operational
   - Disable buttons when viewer not ready (visual feedback)

2. **Improve getAssetView helper**:
   - Add null checks with console warnings
   - Return early if viewer not ready

3. **Add tool state reset**:
   - Reset `activeTool` when viewer becomes unavailable
   - Clear tool state on errors

4. **Debounce rapid clicks**:
   - Prevent multiple rapid tool activations

### Part C: Ensure Content Sections Always Visible

Update VisualizationToolbar to show key sections regardless of dynamic data:

```text
+------------------------------------------+
| Vy-alternativ (Header)                   |
+------------------------------------------+
| Vyalternativ                             |
|   X-ray läge                    [Switch] |
|   Visa rum                      [Switch] |
|   Navigationskub                [Switch] |
|   Minimap                       [Switch] |
|   Annotationer                  [Switch] |
+------------------------------------------+
| Visualisering                            |
|   Modellträd                    [Switch] |
|   Rumsvisualisering             [Switch] |
+------------------------------------------+
| BIM-modeller (if available)              |
|   Model A                       [Switch] |
|   Model B                       [Switch] |
+------------------------------------------+
| Våningsplan (if available)               |
|   Plan 1                        [Switch] |
|   Plan 2                        [Switch] |
+------------------------------------------+
| Objektdata                               |
|   Objektinfo (Asset+)           [Button] |
|   Egenskaper                    [Button] |
|   Registrera tillgång           [Button] |
+------------------------------------------+
| Inställningar                            |
|   Anpassa verktygsfält          [Button] |
+------------------------------------------+
```

## File Changes

| File | Changes |
|------|---------|
| `src/components/viewer/VisualizationToolbar.tsx` | Fix ref access, add fallbacks, improve data loading |
| `src/components/viewer/ViewerToolbar.tsx` | Add readiness guards, debounce, improve reliability |

## Detailed Implementation

### VisualizationToolbar.tsx Changes

1. **Line 119-121** - Fix `getXeokitViewer`:
```typescript
const getXeokitViewer = useCallback(() => {
  // Use the correct ref chain for XEOKit access
  const assetViewer = viewerRef.current?.$refs?.AssetViewer;
  return assetViewer?.$refs?.assetView?.viewer;
}, [viewerRef]);
```

2. **Lines 200-240** - Fix models/floors data fetching:
```typescript
useEffect(() => {
  if (!isOpen) return;
  
  // Add small delay to ensure viewer is ready
  const timer = setTimeout(() => {
    try {
      const xeokitViewer = getXeokitViewer();
      
      // Get models from XEOKit metaScene (not Asset+ API)
      if (xeokitViewer?.metaScene?.metaModels) {
        const models = Object.values(xeokitViewer.metaScene.metaModels).map((m: any) => ({
          id: m.id,
          name: m.id, // Model ID as name
          visible: true,
        }));
        setAvailableModels(models);
      }
      
      // Floors logic remains similar but with better error handling
      // ...
    } catch (e) {
      console.debug('Models/floors fetch:', e);
    }
  }, 100);
  
  return () => clearTimeout(timer);
}, [isOpen, getXeokitViewer]);
```

3. **Add loading/empty state UI** after line 406:
```typescript
{/* Show message if no dynamic content loaded */}
{availableModels.length === 0 && availableFloors.length === 0 && (
  <div className="text-xs text-muted-foreground italic py-2">
    Laddar modelldata...
  </div>
)}
```

### ViewerToolbar.tsx Changes

1. **Add viewer readiness state** after line 67:
```typescript
const [isViewerReady, setIsViewerReady] = useState(false);

useEffect(() => {
  const checkReady = () => {
    const assetView = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView;
    setIsViewerReady(!!assetView?.viewer);
  };
  
  // Check on mount and after short delay
  checkReady();
  const timer = setTimeout(checkReady, 500);
  return () => clearTimeout(timer);
}, [viewerRef]);
```

2. **Update getAssetView** (lines 87-89):
```typescript
const getAssetView = useCallback(() => {
  const assetView = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView;
  if (!assetView) {
    console.debug('AssetView not ready');
  }
  return assetView;
}, [viewerRef]);
```

3. **Disable buttons when not ready** - Update ToolButton:
```typescript
const ToolButton = React.forwardRef<...>(({ ..., disabled }, ref) => {
  // Add disabled prop handling
  return (
    <Button
      ref={ref}
      disabled={disabled || !isViewerReady}
      // ...
    />
  );
});
```

4. **Add click debouncing** to tool handlers:
```typescript
const handleToolChange = useCallback((tool: ViewerTool) => {
  if (!isViewerReady) {
    console.debug('Viewer not ready for tool change');
    return;
  }
  // ... rest of existing logic
}, [getAssetView, activeTool, isViewerReady]);
```

## Testing Checklist

After implementation:
- [ ] Open 3D viewer with a building
- [ ] Click right overflow menu (three dots) - Sheet should open with all sections visible
- [ ] Verify X-ray, Spaces, NavCube, Minimap, Annotations toggles work
- [ ] Verify Modellträd and Rumsvisualisering toggles work
- [ ] Verify BIM models section shows loaded models (if any)
- [ ] Verify Floors section shows building floors
- [ ] Verify Objektdata buttons work (Objektinfo, Egenskaper, Registrera tillgång)
- [ ] Test bottom toolbar: Orbit/First Person toggle
- [ ] Test bottom toolbar: Zoom in/out/fit
- [ ] Test bottom toolbar: Select/Measure/Slicer tools
- [ ] Test bottom toolbar: 2D/3D toggle
- [ ] Test Flash and Hover toggles
- [ ] Verify rapid clicking doesn't break tool state
