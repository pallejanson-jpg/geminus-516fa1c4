

# Plan: Tree-isolering och strategi för desktop/mobil-paritet

## Problemanalys

Systemet har **tre separata kodvägar** för våningssynlighet:

1. **FloorVisibilitySelector** (desktop sidebar) — har solo-mode, IfcCovering-döljning, ceiling clipping, event dispatch
2. **handleMobileFloorToggle** i AssetPlusViewer — delvis kopierad logik, fixas successivt
3. **ViewerTreePanel.handleVisibilityChange** — enkel toggle, ingen solo-mode, ingen IfcCovering-döljning

Detta innebar att varje ny feature/fix maste implementeras pa tre stallen. Treet saknar helt den isoleringslogik som anvandaren forvantar sig.

## Del 1: Fixa Tree-checkboxarnas beteende

### Nuvarande beteende (ViewerTreePanel rad 462-524)
- Checkbox togglar synlighet for noden och alla barn
- Ingen "solo mode" — kryssar du i en vaning visas den *utover* allt annat
- IfcCovering doljs aldrig
- Event dispatchar korrekt till FloorSelectionChanged men utan att faktiskt isolera

### Nytt beteende

**Vaningsval (IfcBuildingStorey):**
- Kryssar du i EN vaning -> solo mode: dolj alla andra vaningar, dolj IfcCovering
- Kryssar du i ytterligare vaningar -> de laggs till (multi-select)
- Avkryssar du alla -> visa allt (aterstaell)

**Rumsval (IfcSpace):**
- Kryssar du i ett eller flera rum -> bara de rummen (och deras foraldravanings geometri) visas
- Avkryssar du alla rum -> aterstall till vaningsvisning

### Andringar i `ViewerTreePanel.tsx`

I `handleVisibilityChange` (rad 462-524):

```typescript
const handleVisibilityChange = useCallback((node: TreeNode, visible: boolean) => {
  const xeokitViewer = getXeokitViewer();
  const scene = xeokitViewer?.scene;
  const metaScene = xeokitViewer?.metaScene;
  if (!scene || !metaScene) return;

  const nodeType = node.type?.toLowerCase() || '';

  // --- STOREY ISOLATION ---
  if (nodeType === 'ifcbuildingstorey') {
    if (visible) {
      // Hide ALL objects first
      if (scene.objectIds) {
        scene.setObjectsVisible(scene.objectIds, false);
      }
      
      // Show only checked storey(s): this node + any already-visible storeys
      const setVisibilityRecursive = (n, vis) => { ... };
      setVisibilityRecursive(node, true);
      
      // Also re-show any other storeys that are still checked
      // (read from current tree state)
      
      // Hide IfcCovering in solo mode
      const visibleStoreys = /* count visible storeys */;
      if (visibleStoreys === 1) {
        const coveringIds = [];
        Object.values(metaScene.metaObjects).forEach((mo) => {
          if (mo.type?.toLowerCase() === 'ifccovering') coveringIds.push(mo.id);
        });
        scene.setObjectsVisible(coveringIds, false);
      }
    } else {
      // Unchecking — hide this storey
      setVisibilityRecursive(node, false);
      
      // If nothing visible, show all
      const anyVisible = /* check */;
      if (!anyVisible) {
        scene.setObjectsVisible(scene.objectIds, true);
      }
    }
    
    // Dispatch FLOOR_SELECTION_CHANGED_EVENT (existing code)
    ...
  }
  
  // --- SPACE ISOLATION ---
  else if (nodeType === 'ifcspace') {
    if (visible) {
      // Hide all objects in the scene
      scene.setObjectsVisible(scene.objectIds, false);
      
      // Show only the selected space(s)
      setVisibilityRecursive(node, true);
      
      // Also re-show any other already-checked spaces
    } else {
      setVisibilityRecursive(node, false);
      // If no spaces checked, restore floor visibility
    }
  }
  
  // --- OTHER TYPES (walls, doors etc) — keep additive toggle ---
  else {
    setVisibilityRecursive(node, visible);
  }

  refreshVisibilityState();
}, [getXeokitViewer, refreshVisibilityState]);
```

---

## Del 2: Strategi for desktop/mobil-paritet

### Grundorsak
Desktop och mobil har **separata UI-komponenter** som var och en implementerar sin egen synlighetslogik. Nasta gang en fix gors pa ena sidan missar den andra.

### Rekommenderad strategi: Delad "visibility engine"

Skapa en delad hook/utility som kapslar in ALL synlighetslogik:

```
useFloorVisibility(viewerRef, buildingFmGuid)
  -> floors, visibleFloorIds
  -> toggleFloor(id, visible)    // hanterar solo, IfcCovering, event dispatch
  -> toggleAllFloors(visible)
  -> isolateSpaces(spaceIds[])
  -> resetVisibility()
```

Bade `FloorVisibilitySelector`, `handleMobileFloorToggle`, och `ViewerTreePanel` anropar denna hook istallet for att ha egen logik.

**Detta ar ett storre refaktoreringsarbete** som bor goras stegvis. Som forsta steg fixar vi Tree-beteendet enligt Del 1, och noterar att den delade hooken ar nasta logiska forbattring.

---

## Sammanfattning av filandringar (Del 1)

```
src/components/viewer/ViewerTreePanel.tsx
  - handleVisibilityChange: Ersatt additivt toggle med isoleringslogik
    - IfcBuildingStorey: solo mode vid enstaka val, dolj IfcCovering
    - IfcSpace: isolera valda rum, dolj ovrig geometri
    - Ovriga typer: behal additivt beteende
    - Anvand scene.setObjectsVisible() for batch-prestanda
```

## Forvantat resultat

- Kryssar du i EN vaning i tree -> bara den vaningen visas (solo mode)
- Kryssar du i tva rum -> bara de tva rummen visas
- Avkryssar du allt -> aterstaeller hela vyn
- IfcCovering doljs automatiskt i solo-mode
- Beteendet ar identiskt oavsett om tree oppnas pa desktop eller mobil (samma komponent)
