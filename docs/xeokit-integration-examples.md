# xeokit SDK Integration Examples

This directory contains reference examples for xeokit SDK features that can be used with the Asset+ 3D Viewer.

## Examples

### 1. Select & Flash Example (`xeokit-select-flash-example.html`)

Demonstrates how to:
- Detect clicked objects in the 3D scene
- Apply a flashing/pulsing highlight effect to selected objects
- Toggle between highlighted and normal colors

**Key code:**
```javascript
// Start flashing effect
function startFlashing(entity) {
    let visible = true;
    flashInterval = setInterval(() => {
        entity.colorize = visible ? [1, 0, 0] : [1, 1, 1]; // Red / White
        visible = !visible;
    }, 300);
}

// Listen for clicks
viewer.scene.input.on("mouseclicked", (coords) => {
    const hit = viewer.scene.pick({ canvasPos: coords });
    if (hit && hit.entity) {
        startFlashing(hit.entity);
    }
});
```

### 2. TreeViewPlugin Example (`xeokit-treeview-example.html`)

Demonstrates the xeokit TreeViewPlugin for hierarchical navigation:
- Display IFC model structure in a tree view
- Navigate by storeys (floors)
- Automatic sorting and expansion
- Mouse hover highlighting

**Key code:**
```javascript
const treeView = new TreeViewPlugin(viewer, {
    containerElement: document.getElementById("treeViewContainer"),
    autoExpandDepth: 1,
    hierarchy: "storeys",
    sortNodes: true,
    sortableStoreysTypes: [
        "IfcWall", "IfcSlab", "IfcFurniture", "IfcDoor", "IfcRoof"
    ]
});
```

## Integration in Asset+ Viewer

These features are integrated in the React components:

### Flash Highlighting (`useFlashHighlight.ts`)

A React hook that provides:
- `startFlashing(entity, options)` - Start flashing effect on an entity
- `stopFlashing()` - Stop current flashing
- `flashEntityById(scene, entityId, options)` - Flash by entity ID
- `handlePickAndFlash(viewer, canvasPos, options)` - Pick and flash in one call

**Usage:**
```tsx
import { useFlashHighlight } from '@/hooks/useFlashHighlight';

const { flashEntityById, stopFlashing } = useFlashHighlight();

// Flash on selection
flashEntityById(scene, entityId, {
    color1: [1, 0.3, 0.3],  // Highlight color (red)
    color2: [1, 1, 1],      // Normal color (white)
    interval: 200,          // Flash interval ms
    duration: 2000,         // Total duration ms (0 = infinite)
});
```

### Tree View Panel (`ViewerTreePanel.tsx`)

A React component that provides:
- Hierarchical model navigation
- Search/filter functionality
- Click to select and fly-to
- Hover to highlight
- Auto-expand first levels

**Integration:**
```tsx
<ViewerTreePanel
    viewerRef={viewerInstanceRef}
    isVisible={showTreePanel}
    onClose={() => setShowTreePanel(false)}
    onNodeSelect={(nodeId, fmGuid) => {
        // Handle selection
    }}
/>
```

## References

- [xeokit SDK Documentation](https://xeokit.github.io/xeokit-sdk/docs/)
- [TreeViewPlugin API](https://xeokit.github.io/xeokit-sdk/docs/class/src/plugins/TreeViewPlugin/TreeViewPlugin.js~TreeViewPlugin.html)
- [NavCubePlugin API](https://xeokit.github.io/xeokit-sdk/docs/class/src/plugins/NavCubePlugin/NavCubePlugin.js~NavCubePlugin.html)
