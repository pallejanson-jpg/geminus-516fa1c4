
# Plan: Mobil 3D Viewer & Förbättrad TreeView

## Sammanfattning

Användaren vill:
1. **Dedikerad Mobil 3D Viewer** - Som MobileInventoryWizard men för 3D-viewern
2. **TreeView-förbättringar:**
   - Checkboxar för att tända/släcka objekt (visibility toggle)
   - Börja trädet från våningsplan (skippa Site/Building-nivåer)
   - Visa meningsfulla typnamn (Vägg, Dörr, Fönster) istället för 128-bitars GUIDs

---

## Del 1: Förbättrad TreeView (ViewerTreePanel.tsx)

### Problem 1: Inga checkboxar för visibility

**Nuvarande:** Klick på en nod selekterar och flyger till objektet, men kan inte visa/dölja.

**Lösning:** Lägg till en checkbox framför varje nod som togglar `entity.visible`:

```typescript
interface TreeNode {
  id: string;
  name: string;
  type: string;
  children?: TreeNode[];
  fmGuid?: string;
  objectCount?: number;
  visible: boolean; // NY: spåra synlighet
  indeterminate: boolean; // NY: för delvis checkade parents
}

// I TreeNodeComponent:
<Checkbox
  checked={node.visible}
  indeterminate={node.indeterminate}
  onCheckedChange={(checked) => {
    // Toggla visibility för denna nod och alla barn
    toggleNodeVisibility(node, checked);
  }}
  className="h-4 w-4 mr-1"
/>
```

**Visibility-logik:**
```typescript
const toggleNodeVisibility = (node: TreeNode, visible: boolean) => {
  const xeokitViewer = getXeokitViewer();
  const scene = xeokitViewer?.scene;
  if (!scene) return;

  // Toggla denna nod
  const entity = scene.objects[node.id];
  if (entity) {
    entity.visible = visible;
  }

  // Toggla alla barn rekursivt
  const toggleChildren = (n: TreeNode) => {
    n.children?.forEach(child => {
      const childEntity = scene.objects[child.id];
      if (childEntity) {
        childEntity.visible = visible;
      }
      toggleChildren(child);
    });
  };
  toggleChildren(node);

  // Uppdatera state för att reflektera ändringarna
  refreshVisibilityState();
};
```

### Problem 2: Trädet börjar för högt upp (Site/Building)

**Nuvarande (rad 264-268):**
```typescript
Object.values(rootMetaObjects).forEach((rootObj: any) => {
  const node = buildNode(rootObj);
  tree.push(node);
});
```

**Lösning:** Börja trädet från IfcBuildingStorey-nivån:

```typescript
// Ny funktion: Hitta alla storeys och börja därifrån
const findStoreys = (metaObject: any): any[] => {
  const storeys: any[] = [];
  
  const traverse = (obj: any) => {
    if (obj.type === 'IfcBuildingStorey') {
      storeys.push(obj);
      return; // Stoppa här, inkludera inte barnens storeys
    }
    obj.children?.forEach(traverse);
  };
  
  traverse(metaObject);
  return storeys;
};

// I buildTree():
Object.values(rootMetaObjects).forEach((rootObj: any) => {
  const storeys = findStoreys(rootObj);
  storeys.forEach(storey => {
    const node = buildNode(storey);
    tree.push(node);
  });
});

// Sortera storeys efter våningsnummer
tree.sort(sortByStoreyLevel);
```

### Problem 3: Visar GUIDs istället för meningsfulla namn

**Nuvarande (rad 231-240):**
```typescript
const node: TreeNode = {
  id: metaObject.id,
  name: metaObject.name || metaObject.id, // <-- PROBLEM: fallback till ID (GUID)
  type: metaObject.type || 'Unknown',
  ...
};
```

**Lösning:** Förbättra namnhantering med typ-översättning och bättre fallbacks:

```typescript
// Översättningstabell för IFC-typer till svenska
const IFC_TYPE_LABELS: Record<string, string> = {
  'IfcWall': 'Vägg',
  'IfcWallStandardCase': 'Vägg',
  'IfcSlab': 'Bjälklag',
  'IfcDoor': 'Dörr',
  'IfcWindow': 'Fönster',
  'IfcColumn': 'Pelare',
  'IfcBeam': 'Balk',
  'IfcStair': 'Trappa',
  'IfcRoof': 'Tak',
  'IfcSpace': 'Rum',
  'IfcBuildingStorey': 'Våning',
  'IfcFurniture': 'Möbel',
  'IfcFurnishingElement': 'Inredning',
  'IfcRailing': 'Räcke',
  'IfcCovering': 'Beklädnad',
  'IfcPlate': 'Platta',
  'IfcMember': 'Element',
  'IfcOpeningElement': 'Öppning',
};

// Förbättrad namnlogik
const getDisplayName = (metaObject: any): string => {
  // 1. Försök med namn från modellen
  if (metaObject.name && !isGuid(metaObject.name)) {
    return metaObject.name;
  }
  
  // 2. Försök med LongName från PropertySets
  const longName = metaObject.propertySetsByName?.Pset_SpaceCommon?.LongName ||
                   metaObject.propertySetsByName?.Pset_WallCommon?.Reference ||
                   metaObject.attributes?.LongName;
  if (longName && !isGuid(longName)) {
    return longName;
  }
  
  // 3. Använd översatt typ + index
  const typeLabel = IFC_TYPE_LABELS[metaObject.type] || metaObject.type?.replace('Ifc', '') || 'Objekt';
  
  // Räkna antal av samma typ bland syskon
  const siblings = metaObject.parent?.children || [];
  const sameTypeSiblings = siblings.filter((s: any) => s.type === metaObject.type);
  const index = sameTypeSiblings.indexOf(metaObject) + 1;
  
  return `${typeLabel} ${index}`;
};

// Hjälpfunktion för att upptäcka GUIDs
const isGuid = (str: string): boolean => {
  if (!str || str.length < 20) return false;
  // Matcha typiska GUID-format (med eller utan bindestreck)
  return /^[0-9a-f]{8}[-]?[0-9a-f]{4}[-]?[0-9a-f]{4}[-]?[0-9a-f]{4}[-]?[0-9a-f]{12}$/i.test(str) ||
         /^[0-9a-zA-Z$_]{22,}$/.test(str); // Base64-kodade IFC GUIDs
};
```

---

## Del 2: Dedikerad Mobil 3D Viewer

### Arkitektur

Följ samma mönster som MobileInventoryWizard:
- Detektera mobil med `useIsMobile()` hook
- Rendera helt separat mobilkomponent
- Fullskärmsvy med touch-optimerade kontroller
- Minimalistiskt gränssnitt - bara det mest nödvändiga

### Ny Fil: `src/components/viewer/mobile/MobileViewer.tsx`

```typescript
import React, { useState, useRef, useCallback } from 'react';
import { ChevronLeft, Maximize2, Settings2, TreeDeciduous, Layers, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import ViewerTreePanel from '../ViewerTreePanel';

interface MobileViewerProps {
  fmGuid: string;
  onClose?: () => void;
}

type MobileViewerMode = 'view' | 'tree' | 'settings';

const MobileViewer: React.FC<MobileViewerProps> = ({ fmGuid, onClose }) => {
  const viewerRef = useRef<any>(null);
  const [mode, setMode] = useState<MobileViewerMode>('view');
  const [showFloorsDrawer, setShowFloorsDrawer] = useState(false);
  
  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header - kompakt */}
      <div className="flex items-center justify-between p-2 bg-card/80 backdrop-blur-sm z-10">
        <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        
        <h1 className="text-sm font-medium truncate flex-1 mx-2 text-center">
          3D Viewer
        </h1>
        
        <div className="flex items-center gap-1">
          <Button 
            variant={mode === 'tree' ? 'default' : 'ghost'} 
            size="icon" 
            className="h-9 w-9"
            onClick={() => setMode(mode === 'tree' ? 'view' : 'tree')}
          >
            <TreeDeciduous className="h-4 w-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-9 w-9"
            onClick={() => setShowFloorsDrawer(true)}
          >
            <Layers className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Viewer canvas - tar upp resten */}
      <div className="flex-1 relative">
        {/* Asset+ viewer laddas här */}
        <div id="mobile-viewer-container" ref={viewerRef} className="w-full h-full" />
        
        {/* TreeView overlay - från höger */}
        {mode === 'tree' && (
          <div className="absolute inset-y-0 left-0 w-4/5 max-w-80 z-20 bg-card/95 backdrop-blur-md border-r shadow-xl">
            <ViewerTreePanel
              viewerRef={viewerRef}
              isVisible={true}
              onClose={() => setMode('view')}
              embedded={false}
              // Nya props för förbättrad funktionalitet:
              showVisibilityCheckboxes={true}
              startFromStoreys={true}
            />
          </div>
        )}
      </div>

      {/* Bottom quick actions */}
      <div className="flex items-center justify-around p-2 bg-card/80 backdrop-blur-sm border-t">
        <Button variant="ghost" size="sm" className="flex-1">
          <Eye className="h-4 w-4 mr-1" />
          Rum
        </Button>
        <Button variant="ghost" size="sm" className="flex-1">
          2D
        </Button>
        <Button variant="ghost" size="sm" className="flex-1">
          3D
        </Button>
      </div>

      {/* Floors drawer - bottom sheet */}
      <Drawer open={showFloorsDrawer} onOpenChange={setShowFloorsDrawer}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Välj våningar</DrawerTitle>
          </DrawerHeader>
          {/* FloorCarousel eller lista */}
        </DrawerContent>
      </Drawer>
    </div>
  );
};

export default MobileViewer;
```

### Uppdatera AssetPlusViewer.tsx

```typescript
import { useIsMobile } from '@/hooks/use-mobile';
import MobileViewer from './mobile/MobileViewer';

const AssetPlusViewer: React.FC<AssetPlusViewerProps> = (props) => {
  const isMobile = useIsMobile();

  // På mobil: rendera dedikerad mobil-viewer
  if (isMobile) {
    return <MobileViewer fmGuid={props.fmGuid} onClose={props.onClose} />;
  }

  // Desktop: befintlig kod
  return (
    // ... befintlig implementation
  );
};
```

---

## Del 3: Nya TreeView Props

Utöka ViewerTreePanel med nya props:

```typescript
interface ViewerTreePanelProps {
  viewerRef: React.RefObject<any>;
  isVisible: boolean;
  onClose: () => void;
  onNodeSelect?: (nodeId: string, fmGuid?: string) => void;
  onNodeHover?: (nodeId: string | null) => void;
  embedded?: boolean;
  // NYA PROPS:
  showVisibilityCheckboxes?: boolean; // Visa checkboxar för visibility
  startFromStoreys?: boolean; // Börja trädet från våningsplan
}
```

---

## Filer som Påverkas

| Fil | Ändringar |
|-----|-----------|
| `src/components/viewer/ViewerTreePanel.tsx` | Checkboxar, storey-start, bättre namn |
| `src/components/viewer/mobile/MobileViewer.tsx` | **NY FIL** - Mobil 3D viewer |
| `src/components/viewer/AssetPlusViewer.tsx` | Villkorlig rendering för mobil |

---

## Flödesöversikt

```text
┌────────────────────────────────────────────────────────────────┐
│              DESKTOP 3D VIEWER (befintlig)                     │
├────────────────────────────────────────────────────────────────┤
│  ┌─────────┐ ┌────────────────────────────┐ ┌──────────────┐  │
│  │TreeView │ │      3D Canvas             │ │VisToolbar   │  │
│  │ ☑ Vån 1 │ │                            │ │ [2D] [3D]   │  │
│  │  ☐ Vägg │ │                            │ │ [Rum] [Ann] │  │
│  │  ☑ Dörr │ │                            │ │             │  │
│  │ ☑ Vån 2 │ │                            │ │             │  │
│  └─────────┘ └────────────────────────────┘ └──────────────┘  │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│                 MOBIL 3D VIEWER (ny)                           │
├────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────┐   │
│  │ [←]         3D Viewer          [🌲] [📄]              │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                                                        │   │
│  │               3D Canvas (fullskärm)                    │   │
│  │                                                        │   │
│  │  ┌─── TreeView overlay ───┐                           │   │
│  │  │ 🔍 Sök...             │                            │   │
│  │  │ ☑ Våning 1            │                            │   │
│  │  │   ☐ Vägg 1            │                            │   │
│  │  │   ☐ Vägg 2            │                            │   │
│  │  │   ☑ Dörr 1            │                            │   │
│  │  │ ☑ Våning 2            │                            │   │
│  │  └────────────────────────┘                           │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐   │
│  │   [👁 Rum]    [2D]    [3D]                             │   │
│  └────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

---

## Förväntade Resultat

1. **Visibility checkboxar** - Användare kan tända/släcka individuella objekt och grupper
2. **Bättre trädstruktur** - Börjar från våningsplan, inte Site/Building
3. **Läsbara namn** - "Vägg 1", "Dörr 3" istället för "3xF$7dQ8kB..."
4. **Mobil-optimerad viewer** - Touch-vänlig med minimalistiskt UI
5. **Konsekvent UX** - Samma mönster som MobileInventoryWizard
