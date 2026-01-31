

# Plan: Wire MobileViewerOverlay to Existing AssetPlusViewer State

## Overview

The `MobileViewerOverlay` component already has the UI for 2D/3D toggle, annotations, room labels, and BIM models, but the props are currently set to defaults because `AssetPlusViewer` doesn't pass the actual state values. This plan connects the existing state in `AssetPlusViewer` to the mobile overlay.

---

## Current State Analysis

### What MobileViewerOverlay expects (already defined):
```tsx
interface MobileViewerOverlayProps {
  is2DMode?: boolean;                    // Currently defaults to false
  onToggle2DMode?: (is2D: boolean) => void;
  showAnnotations?: boolean;             // Currently defaults to false  
  onShowAnnotationsChange?: (show: boolean) => void;
  showRoomLabels?: boolean;              // Currently defaults to false
  onShowRoomLabelsChange?: (show: boolean) => void;
  onOpenVisualizationPanel?: () => void;
  models?: MobileModelInfo[];            // Currently defaults to []
  onModelToggle?: (modelId: string, visible: boolean) => void;
}
```

### What AssetPlusViewer already has:
| State | Location | Current Usage |
|-------|----------|---------------|
| `currentViewMode` ('2d'/'3d') | Line 1752 | Used for Gunnar context |
| `showAnnotations` | Line 133 | Passed to VisualizationToolbar |
| `showVisualizationPanel` | Line 130 | Opens room visualization |
| Room labels | Via `setRoomLabelsEnabled` hook | Line 169 |
| Model visibility | Not currently tracked in state | Only in VisualizationToolbar |

---

## Implementation

### File: `src/components/viewer/AssetPlusViewer.tsx`

#### 1. Add missing state for models and room labels

```tsx
// Around line 140-142 (after other state declarations)
const [showRoomLabels, setShowRoomLabels] = useState(false);
const [visibleModelIds, setVisibleModelIds] = useState<string[]>([]);
const [availableModels, setAvailableModels] = useState<{id: string; name: string; visible: boolean}[]>([]);
```

#### 2. Create handler for 2D mode toggle (mobile-friendly)

```tsx
// After line 315 (after handleVisibleFloorsChange)
const handleToggle2DMode = useCallback((is2D: boolean) => {
  const mode = is2D ? '2d' : '3d';
  window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, {
    detail: { mode }
  }));
}, []);
```

#### 3. Create handlers for room labels and annotations

```tsx
// Handle room labels toggle
const handleRoomLabelsToggle = useCallback((enabled: boolean) => {
  setShowRoomLabels(enabled);
  setRoomLabelsEnabled(enabled);
}, [setRoomLabelsEnabled]);

// Handle annotations toggle - using existing showAnnotations state
const handleAnnotationsChange = useCallback((show: boolean) => {
  setShowAnnotations(show);
  // Trigger annotation visibility update in viewer
  const assetView = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView;
  assetView?.setAnnotationsVisible?.(show);
}, []);
```

#### 4. Create model visibility handler

```tsx
// Handle individual model visibility toggle
const handleModelToggle = useCallback((modelId: string, visible: boolean) => {
  const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  if (!xeokitViewer?.scene) return;
  
  // Toggle model visibility in xeokit
  const model = xeokitViewer.scene.models[modelId];
  if (model) {
    model.visible = visible;
  }
  
  // Update state
  setAvailableModels(prev => 
    prev.map(m => m.id === modelId ? { ...m, visible } : m)
  );
}, []);
```

#### 5. Update MobileViewerOverlay props (around line 2400-2412)

```tsx
{isMobile && state.isInitialized && (
  <MobileViewerOverlay
    onClose={onClose}
    viewerInstanceRef={viewerInstanceRef}
    buildingName={assetData?.commonName || assetData?.name}
    showSpaces={showSpaces}
    onShowSpacesChange={handleShowSpacesChange}
    floors={mobileFloors}
    onFloorToggle={handleMobileFloorToggle}
    onResetCamera={handleResetCamera}
    isViewerReady={modelLoadState === 'loaded' && initStep === 'ready'}
    // NEW PROPS - connect to existing state
    is2DMode={currentViewMode === '2d'}
    onToggle2DMode={handleToggle2DMode}
    showAnnotations={showAnnotations}
    onShowAnnotationsChange={handleAnnotationsChange}
    showRoomLabels={showRoomLabels}
    onShowRoomLabelsChange={handleRoomLabelsToggle}
    onOpenVisualizationPanel={() => setShowVisualizationPanel(true)}
    models={availableModels}
    onModelToggle={handleModelToggle}
  />
)}
```

#### 6. Populate models list when viewer loads

Add effect to extract available models from xeokit scene:

```tsx
// After model load completes, extract model list
useEffect(() => {
  if (modelLoadState !== 'loaded' || initStep !== 'ready') return;
  
  const extractModels = () => {
    const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.scene?.models) return;
    
    const models = Object.entries(xeokitViewer.scene.models).map(([id, model]: [string, any]) => ({
      id,
      name: model.id || id,
      visible: model.visible !== false
    }));
    
    setAvailableModels(models);
  };
  
  // Small delay to ensure models are fully loaded
  const timer = setTimeout(extractModels, 500);
  return () => clearTimeout(timer);
}, [modelLoadState, initStep]);
```

---

## Visual Result

After wiring, the mobile drawer will have fully functional controls:

```
┌─────────────────────────────────┐
│ View Settings               [x] │
├─────────────────────────────────┤
│ DISPLAY                         │
│ [x] 2D View          [toggle] ← ← Connected to currentViewMode
│ [x] Show Spaces      [toggle] ← ← Already connected
│ [ ] Annotations      [toggle] ← ← Connected to showAnnotations
│ [ ] Room Labels      [toggle] ← ← Connected to showRoomLabels
│ [ ] Room Visualization   [>] ← ← Opens showVisualizationPanel
├─────────────────────────────────┤
│ ▶ FLOORS (3/5)               ▼  │  ← Already connected
├─────────────────────────────────┤
│ ▶ BIM MODELS (2/3)           ▼  │  ← Connected to availableModels
│   [✓] A-Arkitektur              │
│   [✓] V-VVS                     │
│   [ ] E-El                      │
├─────────────────────────────────┤
│     [Reset Camera]              │
└─────────────────────────────────┘
```

---

## Files Modified

| File | Changes |
|------|---------|
| `src/components/viewer/AssetPlusViewer.tsx` | Add state for models/labels, create handlers, wire props to MobileViewerOverlay |

---

## Technical Notes

1. **Event-Based 2D Toggle**: Uses `VIEW_MODE_REQUESTED_EVENT` which ViewerToolbar already listens for - this ensures the actual section plane clipping logic is triggered correctly.

2. **Model Visibility**: Directly manipulates xeokit `scene.models[id].visible` property, same pattern used by ModelVisibilitySelector.

3. **No Breaking Changes**: All new props to MobileViewerOverlay are optional with sensible defaults, so existing functionality is preserved.

