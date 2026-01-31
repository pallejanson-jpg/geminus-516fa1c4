
# Plan: Mobile 3D Viewer Improvements & Onboarding Access

## Overview

This plan addresses five issues:
1. **Onboarding access** - Add automatic redirect for new users + link in UI
2. **Missing tools in mobile right drawer** - Add all VisualizationToolbar features
3. **Collapsible floor selector** - Use accordion pattern
4. **Persist Tree selections during session** - Lift state to parent component
5. **Select All in Tree** - Add header buttons

---

## Part 1: Onboarding Access

### Current Behavior
The onboarding page exists at `/onboarding` but users must navigate manually.

### Solution
1. Add a "Skip to onboarding" button in the Login page
2. Modify `ProtectedRoute` or home redirect to check if user has completed onboarding

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/Login.tsx` | Add link to onboarding after login |
| `src/components/auth/ProtectedRoute.tsx` | Check onboarding status, redirect if needed |

---

## Part 2: Add Missing Tools to Mobile Right Drawer

### Current State (MobileViewerOverlay)
```
┌─────────────────────┐
│ View Settings    [x]│
├─────────────────────┤
│ [x] Show Spaces     │
│ ─────────────────── │
│ Floors (3/5)        │
│ [Show All][Hide All]│
│ [Floor 1 - visible] │
│ [Floor 2 - visible] │
│ [Floor 3 - hidden]  │
│ ─────────────────── │
│ [Reset Camera]      │
└─────────────────────┘
```

### Target State (matching VisualizationToolbar features)
```
┌───────────────────────────────┐
│ View Settings              [x]│
├───────────────────────────────┤
│ ▼ Display                     │
│   [ ] 2D / 3D                 │
│   [x] Show Spaces             │
│   [ ] Show Annotations        │
│   [ ] Room Labels             │
│   [ ] Room Visualization  [>] │
├───────────────────────────────┤
│ ▶ Floors (3/5)                │ ← Collapsible
│   (collapsed by default)      │
├───────────────────────────────┤
│ ▶ BIM Models                  │ ← Collapsible
│   (collapsed by default)      │
├───────────────────────────────┤
│ ▶ Viewer Settings             │ ← Collapsible
│   Theme: [dropdown]           │
│   Background: [palette]       │
├───────────────────────────────┤
│ [Reset Camera]                │
└───────────────────────────────┘
```

### Implementation

**File: `src/components/viewer/mobile/MobileViewerOverlay.tsx`**

Add new props and sections:
- `is2DMode`, `onToggle2DMode` - for 2D/3D toggle
- `showAnnotations`, `onShowAnnotationsChange`
- `showRoomLabels`, `onShowRoomLabelsChange`
- `onOpenVisualizationPanel` - to launch room visualization
- `visibleModelIds`, `onModelVisibilityChange` - for BIM models

Reorganize with Collapsible components:
- Display section (always visible toggles)
- Floors section (collapsible, closed by default)
- BIM Models section (collapsible, closed by default)
- Viewer Settings section (collapsible, closed by default)

**File: `src/components/viewer/AssetPlusViewer.tsx`**

Pass additional props to MobileViewerOverlay:
- Connect 2D/3D state
- Connect annotations state
- Connect model visibility state
- Connect room labels state

---

## Part 3: Collapsible Floor Selector

### Current Implementation
```tsx
<div className="space-y-1.5 max-h-[200px] overflow-y-auto">
  {floors.map((floor) => (
    <Button ...>{floor.name}</Button>
  ))}
</div>
```

### New Implementation with Collapsible
```tsx
<Collapsible defaultOpen={false}>
  <CollapsibleTrigger asChild>
    <Button variant="ghost" className="w-full justify-between">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4" />
        <span>Floors</span>
        <Badge>{visibleFloorCount}/{floors.length}</Badge>
      </div>
      <ChevronDown className="h-4 w-4 transition-transform data-[state=open]:rotate-180" />
    </Button>
  </CollapsibleTrigger>
  <CollapsibleContent>
    <div className="pl-6 space-y-1.5">
      <div className="flex gap-2 mb-2">
        <Button size="sm" onClick={() => handleToggleAllFloors(true)}>
          Show All
        </Button>
        <Button size="sm" onClick={() => handleToggleAllFloors(false)}>
          Hide All
        </Button>
      </div>
      {floors.map((floor) => (...))}
    </div>
  </CollapsibleContent>
</Collapsible>
```

---

## Part 4: Persist Tree Selections During Session

### Problem
`ViewerTreePanel` maintains state internally:
```tsx
const [selectedId, setSelectedId] = useState<string | null>(null);
const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
```

When the panel closes, this state is lost.

### Solution
Lift state to `AssetPlusViewer` parent:

**File: `src/components/viewer/AssetPlusViewer.tsx`**
```tsx
// New state in AssetPlusViewer
const [treeSelectedId, setTreeSelectedId] = useState<string | null>(null);
const [treeExpandedIds, setTreeExpandedIds] = useState<Set<string>>(new Set());

// Pass to ViewerTreePanel
<ViewerTreePanel
  ...
  selectedId={treeSelectedId}
  onSelectedIdChange={setTreeSelectedId}
  expandedIds={treeExpandedIds}
  onExpandedIdsChange={setTreeExpandedIds}
/>
```

**File: `src/components/viewer/ViewerTreePanel.tsx`**

Add props for controlled state:
```tsx
interface ViewerTreePanelProps {
  ...
  selectedId?: string | null;
  onSelectedIdChange?: (id: string | null) => void;
  expandedIds?: Set<string>;
  onExpandedIdsChange?: (ids: Set<string>) => void;
}
```

Use controlled state when props provided, fallback to internal state otherwise.

---

## Part 5: Select All / Deselect All in Tree

### Current Header
```
┌──────────────────────────────┐
│ ⋮⋮ 🌳 Modellträd  [1,234] [x]│
└──────────────────────────────┘
```

### New Header with Actions
```
┌────────────────────────────────────┐
│ ⋮⋮ 🌳 Modellträd  [1,234]      [x] │
│ ─────────────────────────────────  │
│ [✓ All] [✗ None] [Expand] [Fold]  │
└────────────────────────────────────┘
```

### Implementation

**File: `src/components/viewer/ViewerTreePanel.tsx`**

Add action buttons below header:
```tsx
<div className="flex items-center gap-1 px-2 pb-2 border-b">
  <Button 
    variant="outline" 
    size="sm" 
    className="h-6 text-xs flex-1"
    onClick={() => handleVisibilityAll(true)}
  >
    <Check className="h-3 w-3 mr-1" /> All
  </Button>
  <Button 
    variant="outline" 
    size="sm" 
    className="h-6 text-xs flex-1"
    onClick={() => handleVisibilityAll(false)}
  >
    <X className="h-3 w-3 mr-1" /> None
  </Button>
  <Button 
    variant="outline" 
    size="sm" 
    className="h-6 text-xs"
    onClick={handleExpandAll}
    title="Expand all"
  >
    <ChevronDown className="h-3 w-3" />
  </Button>
  <Button 
    variant="outline" 
    size="sm" 
    className="h-6 text-xs"
    onClick={handleCollapseAll}
    title="Collapse all"
  >
    <ChevronUp className="h-3 w-3" />
  </Button>
</div>
```

Add handler functions:
```tsx
const handleVisibilityAll = useCallback((visible: boolean) => {
  const xeokitViewer = getXeokitViewer();
  const scene = xeokitViewer?.scene;
  if (!scene) return;
  
  // Toggle all objects
  scene.setObjectsVisible(scene.objectIds, visible);
  refreshVisibilityState();
}, [getXeokitViewer, refreshVisibilityState]);

const handleExpandAll = useCallback(() => {
  const allIds = new Set<string>();
  const collectIds = (nodes: TreeNode[]) => {
    nodes.forEach(node => {
      allIds.add(node.id);
      if (node.children) collectIds(node.children);
    });
  };
  collectIds(treeData);
  setExpandedIds(allIds);
}, [treeData]);

const handleCollapseAll = useCallback(() => {
  setExpandedIds(new Set());
}, []);
```

---

## Technical Summary

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/viewer/mobile/MobileViewerOverlay.tsx` | Add all visualization features, use Collapsible for floors/models |
| `src/components/viewer/ViewerTreePanel.tsx` | Add Select All/None, Expand/Collapse buttons; add controlled state props |
| `src/components/viewer/AssetPlusViewer.tsx` | Pass additional props to MobileViewerOverlay; lift tree state |
| `src/components/auth/ProtectedRoute.tsx` | Add onboarding check and redirect |

### Implementation Order

1. **MobileViewerOverlay enhancements** - Add missing tools + collapsible sections
2. **Tree Select All/None** - Add action buttons
3. **Tree state persistence** - Lift state to parent
4. **Onboarding redirect** - Add automatic navigation for new users

---

## Visual Summary

### Mobile Right Drawer (After)
```
┌─────────────────────────────────┐
│ View Settings               [x] │
├─────────────────────────────────┤
│ DISPLAY                         │
│ [x] 2D / 3D                     │
│ [x] Show Spaces                 │
│ [ ] Annotations                 │
│ [ ] Room Labels                 │
│ [ ] Room Visualization      [>] │
├─────────────────────────────────┤
│ ▶ FLOORS (3/5)              [v] │  ← Collapsed
├─────────────────────────────────┤
│ ▶ BIM MODELS (2)            [v] │  ← Collapsed
├─────────────────────────────────┤
│ ▶ VIEWER SETTINGS           [v] │  ← Collapsed
├─────────────────────────────────┤
│     [Reset Camera]              │
└─────────────────────────────────┘
```

### Tree Panel Header (After)
```
┌────────────────────────────────────────┐
│ ⋮⋮ 🌳 Modellträd       [1,234]     [x] │
│ [✓ All] [✗ None]     [Expand][Fold]    │
│ [🔍 Sök...                          ]  │
├────────────────────────────────────────┤
│ ▼ Våning 2                        [25] │
│   ▶ Väggar                         [8] │
│   ▶ Dörrar                         [4] │
│   ...                                  │
└────────────────────────────────────────┘
```
