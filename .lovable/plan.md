

# Part B: 2D Mode Clickability Layering

## What changes
When 2D mode is toggled on, we update the existing `useEffect` handler in `NativeViewerShell.tsx` (lines 621–643) to set pickability per IFC type category:

- **IfcSpace (rooms)** → `pickable = true` (reversed from current `false`) — acts as background catch-all so clicking empty floor selects the room
- **IfcWall, IfcWallStandardCase, IfcSlab, IfcSlabStandardCase, IfcPlate, IfcColumn, IfcBeam, IfcRoof, IfcCovering** → `pickable = false` — structural elements should not intercept clicks
- **IfcDoor, IfcWindow, IfcFurnishingElement, IfcFlowTerminal, etc.** → `pickable = true` (default, no change needed)

When 2D is toggled off, all entities revert to `pickable = true`.

## File: `src/components/viewer/NativeViewerShell.tsx`

Replace lines 621–643 with an expanded handler:

```typescript
// ── 2D mode: adjust pickability per entity type ──────────────
useEffect(() => {
  const STRUCTURAL_TYPES = new Set([
    'ifcwall', 'ifcwallstandardcase', 'ifcwallelementedcase',
    'ifcslab', 'ifcslabstandardcase', 'ifcslabelementedcase',
    'ifcplate', 'ifccolumn', 'ifccolumnstandardcase',
    'ifcbeam', 'ifcbeamstandardcase', 'ifcroof', 'ifccovering',
    'ifccurtainwall', 'ifcmember', 'ifcmemberstandardcase',
    'ifcrailing', 'ifcrailingstandardcase',
  ]);

  const handler = (e: Event) => {
    const { enabled } = (e as CustomEvent<ViewMode2DToggledDetail>).detail || {};
    const viewer = (window as any).__nativeXeokitViewer;
    if (!viewer?.scene || !viewer?.cameraControl) return;

    viewer.cameraControl.navMode = enabled ? 'planView' : 'orbit';

    const metaObjects = viewer.metaScene?.metaObjects;
    if (!metaObjects) return;

    Object.values(metaObjects).forEach((mo: any) => {
      const entity = viewer.scene.objects?.[mo.id];
      if (!entity) return;
      const typeLower = (mo.type || '').toLowerCase();

      if (enabled) {
        // Structural → unpickable; Rooms → pickable (background); everything else stays pickable
        if (STRUCTURAL_TYPES.has(typeLower)) {
          entity.pickable = false;
        }
        // IfcSpace: keep pickable (background catch-all for room clicks)
        // Doors, windows, furniture: remain pickable by default
      } else {
        // Restore all to pickable
        entity.pickable = true;
      }
    });
  };
  window.addEventListener(VIEW_MODE_2D_TOGGLED_EVENT, handler);
  return () => window.removeEventListener(VIEW_MODE_2D_TOGGLED_EVENT, handler);
}, []);
```

This is the only file that needs to change. The orthographic top-down view naturally handles Z-ordering: furniture and doors sit above room polygons, so they get picked first. Rooms cover the floor area and catch any click that doesn't hit an object above.

