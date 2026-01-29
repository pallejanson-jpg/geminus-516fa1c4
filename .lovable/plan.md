
# Plan: Fixa "Visa rum" synlighet och klippning i 3D-visaren

## Sammanfattning av problem

Baserat på analysen finns det tre huvudproblem:

1. **"Visa rum" är inte alltid AV som standard** - Rum visas även när switchen inte är aktiv
2. **Klippning fungerar inte** - Väggar sticker upp i 3D Solo-läge och 2D-slidern har ingen effekt
3. **Rum från fel våningsplan visas** - När "Visa rum" är PÅ och ett våningsplan är valt visas rum från hela byggnaden istället för bara det valda planet

## Del 1: Fixa "Visa rum" standard och våningsplansfiltrering

### Problem
- `showSpaces` i VisualizationToolbar sätts till `false` som standard, MEN:
  - AssetPlusViewer har sin egen logik som inte synkroniseras
  - RoomVisualizationPanel forcerar `showSpaces` PÅ vid öppning
  - Det finns ingen filtrering av rum baserat på synliga våningsplan

### Lösning

#### 1.1 Lyft `showSpaces`-state till AssetPlusViewer
Flytta state-hanteringen från VisualizationToolbar till AssetPlusViewer för att centralisera kontrollen:

```typescript
// AssetPlusViewer.tsx - Ny state
const [showSpaces, setShowSpaces] = useState(false); // ALLTID AV som standard

// Ny callback som VisualizationToolbar och RoomVisualizationPanel kan anropa
const handleShowSpacesChange = useCallback((show: boolean) => {
  setShowSpaces(show);
  
  // Anropa Asset+ viewer API
  const assetViewer = viewerInstanceRef.current?.assetViewer;
  assetViewer?.onShowSpacesChanged?.(show);
  
  // Om PÅ och vi har valda våningsplan, filtrera rum
  if (show && visibleFloorFmGuids.length > 0) {
    filterSpacesToVisibleFloors(visibleFloorFmGuids);
  }
}, [visibleFloorFmGuids]);
```

#### 1.2 Aktiv filtrering av rum per våningsplan
Lägg till ny funktion för att dölja rum som inte tillhör synliga våningsplan:

```typescript
// AssetPlusViewer.tsx - Ny funktion
const filterSpacesToVisibleFloors = useCallback((visibleFloorGuids: string[]) => {
  const viewer = viewerInstanceRef.current;
  const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  if (!xeokitViewer?.metaScene?.metaObjects || !xeokitViewer?.scene) return;
  
  const metaObjects = xeokitViewer.metaScene.metaObjects;
  const scene = xeokitViewer.scene;
  const visibleGuidsLower = new Set(visibleFloorGuids.map(g => g.toLowerCase()));
  
  // Bygg map: storey fmGuid -> storey metaObject ID
  const storeyIdsByFmGuid = new Map<string, string>();
  Object.values(metaObjects).forEach((metaObj: any) => {
    if (metaObj.type?.toLowerCase() === 'ifcbuildingstorey') {
      const fmGuid = (metaObj.originalSystemId || metaObj.id || '').toLowerCase();
      storeyIdsByFmGuid.set(fmGuid, metaObj.id);
    }
  });
  
  // Iterera alla IfcSpace och kontrollera parent storey
  Object.values(metaObjects).forEach((metaObj: any) => {
    if (metaObj.type?.toLowerCase() !== 'ifcspace') return;
    
    // Hitta parent storey
    let parentStorey: any = null;
    let current = metaObj;
    while (current?.parent) {
      current = current.parent;
      if (current?.type?.toLowerCase() === 'ifcbuildingstorey') {
        parentStorey = current;
        break;
      }
    }
    
    if (!parentStorey) return;
    
    const storeyFmGuid = (parentStorey.originalSystemId || parentStorey.id || '').toLowerCase();
    const isVisible = visibleGuidsLower.has(storeyFmGuid);
    
    // Sätt synlighet på rummet
    const entity = scene.objects?.[metaObj.id];
    if (entity) {
      entity.visible = isVisible;
    }
  });
}, []);
```

#### 1.3 Uppdatera VisualizationToolbar
Ta emot `showSpaces` och `onShowSpacesChange` som props istället för intern state:

```typescript
// VisualizationToolbar.tsx - Nya props
interface VisualizationToolbarProps {
  // ... befintliga props
  showSpaces?: boolean;
  onShowSpacesChange?: (show: boolean) => void;
}

// Använd prop istället för lokal state
const handleToggleSpaces = useCallback(() => {
  onShowSpacesChange?.(!showSpaces);
}, [showSpaces, onShowSpacesChange]);
```

---

## Del 2: Fixa 3D Solo-mode klippning vid våningsgräns

### Problem
Klippningen använder fel riktning och klipper vid geometrins maxhöjd istället för vid nästa våningsgräns, vilket gör att väggar sticker upp.

### Lösning

#### 2.1 Korrigera klippningsriktning
xeokit SectionPlane med `dir: [0, -1, 0]` klipper **i riktningen** (dvs neråt från planet), vilket betyder att objekt **ovanför** planet är osynliga. Detta är korrekt för våningsplansklippning.

Problemet är att vi räknar ut fel höjd - vi använder `bounds.maxY + offset` men maxY kan vara för lågt om geometrin inte inkluderar överhängande element.

#### 2.2 Beräkna klipphöjd baserat på nästa våningsplans golv
Istället för att använda geometrins max, hitta nästa våningsplan i ordningen och använd dess `minY`:

```typescript
// useSectionPlaneClipping.ts - Ny funktion
const calculateClipHeightFromFloorBoundary = useCallback((floorId: string): number | null => {
  const viewer = getXeokitViewer();
  if (!viewer?.metaScene?.metaObjects || !viewer?.scene) return null;
  
  const metaObjects = viewer.metaScene.metaObjects;
  
  // Samla alla storeys med deras bounds
  const storeys: { id: string; name: string; minY: number; maxY: number }[] = [];
  
  Object.values(metaObjects).forEach((metaObj: any) => {
    if (metaObj.type?.toLowerCase() !== 'ifcbuildingstorey') return;
    
    // Beräkna bounds för denna storey
    const bounds = calculateFloorBounds(metaObj.id);
    if (bounds) {
      storeys.push({
        id: metaObj.id,
        name: bounds.name,
        minY: bounds.minY,
        maxY: bounds.maxY,
      });
    }
  });
  
  // Sortera efter minY (lägst först = lägsta våningen)
  storeys.sort((a, b) => a.minY - b.minY);
  
  // Hitta vald storey och nästa storey
  const currentIndex = storeys.findIndex(s => s.id === floorId);
  if (currentIndex === -1) return null;
  
  if (currentIndex < storeys.length - 1) {
    // Klipp vid nästa vånings golvnivå
    return storeys[currentIndex + 1].minY;
  } else {
    // Översta våningen - klipp vid egen maxY + offset
    return storeys[currentIndex].maxY + 0.1;
  }
}, [getXeokitViewer, calculateFloorBounds]);
```

#### 2.3 Uppdatera applySectionPlane
Använd den nya beräkningsfunktionen:

```typescript
// useSectionPlaneClipping.ts - Uppdaterad applySectionPlane
const applySectionPlane = useCallback((floorId: string, mode?: ClipMode) => {
  const effectiveMode = mode || clipMode;
  
  let clipHeight: number;
  
  if (effectiveMode === 'ceiling') {
    // 3D Solo-mode: klipp vid nästa våningsgräns
    const boundaryHeight = calculateClipHeightFromFloorBoundary(floorId);
    if (!boundaryHeight) return;
    clipHeight = boundaryHeight;
  } else {
    // 2D floor plan: klipp vid golv + floorCutHeight
    const bounds = calculateFloorBounds(floorId);
    if (!bounds) return;
    clipHeight = bounds.minY + floorCutHeightRef.current;
  }
  
  // Skapa section plane...
  // dir: [0, -1, 0] = klipper ovanför planet
}, [clipMode, calculateFloorBounds, calculateClipHeightFromFloorBoundary]);
```

---

## Del 3: Fixa 2D klipphöjdsslider

### Problem
Slidern dispatchar `CLIP_HEIGHT_CHANGED_EVENT` men `updateFloorCutHeight` uppdaterar inte det aktiva klippplanet korrekt.

### Lösning

#### 3.1 Förbättra updateFloorCutHeight
Problemet är att vi försöker använda `SectionPlanesPlugin.createSectionPlane` men det kanske inte finns tillgängligt. Vi måste också uppdatera positionen på det befintliga planet istället för att skapa ett nytt:

```typescript
// useSectionPlaneClipping.ts - Förbättrad updateFloorCutHeight
const updateFloorCutHeight = useCallback((newHeight: number) => {
  floorCutHeightRef.current = newHeight;
  
  const viewer = getXeokitViewer();
  if (!viewer?.scene) return;
  
  // Beräkna ny absolut Y-position
  let clipY: number;
  
  if (currentFloorIdRef.current) {
    const bounds = calculateFloorBounds(currentFloorIdRef.current);
    clipY = bounds ? bounds.minY + newHeight : newHeight;
  } else {
    const sceneAABB = viewer.scene?.getAABB?.();
    clipY = sceneAABB ? sceneAABB[1] + newHeight : newHeight;
  }
  
  // Uppdatera befintligt section plane direkt om det finns
  if (sectionPlaneRef.current && sectionPlaneRef.current.pos) {
    sectionPlaneRef.current.pos = [0, clipY, 0];
    console.log(`Updated section plane pos to Y=${clipY.toFixed(2)}`);
    return;
  }
  
  // Annars skapa nytt (fallback)
  // ... befintlig kod för att skapa nytt section plane
}, [getXeokitViewer, calculateFloorBounds]);
```

#### 3.2 Alternativ: Använd Asset+ slicer
Asset+ viewer har inbyggd slicer-funktionalitet. Vi kan använda den istället:

```typescript
// Använd Asset+ slicing API
const assetView = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView;
if (assetView?.clearSlices) {
  assetView.clearSlices();
}
// Skapa ny slice vid önskad höjd (om API stödjer det)
```

---

## Del 4: Säkerställ "Visa rum" alltid AV vid interaktioner

### Synkronisering vid våningsplansändring
Uppdatera `handleVisibleFloorsChange` i VisualizationToolbar:

```typescript
// VisualizationToolbar.tsx - Befintlig kod är OK men behöver kontrolleras
const handleVisibleFloorsChange = useCallback((visibleFloorIds: string[]) => {
  onVisibleFloorsChange?.(visibleFloorIds);
  
  // Stäng alltid av "Visa rum" vid våningsbyte
  onShowSpacesChange?.(false);
}, [onVisibleFloorsChange, onShowSpacesChange]);
```

### Synkronisering vid modellbyte
Lägg till liknande logik i ModelVisibilitySelector eller via callback.

---

## Filändringar

| Fil | Ändringar |
|-----|-----------|
| `src/components/viewer/AssetPlusViewer.tsx` | Ny `showSpaces` state, `handleShowSpacesChange`, `filterSpacesToVisibleFloors` |
| `src/components/viewer/VisualizationToolbar.tsx` | Ta emot `showSpaces`/`onShowSpacesChange` som props |
| `src/hooks/useSectionPlaneClipping.ts` | Ny `calculateClipHeightFromFloorBoundary`, uppdatera `applySectionPlane` och `updateFloorCutHeight` |
| `src/components/viewer/FloorVisibilitySelector.tsx` | Se till att `handleShowOnlyFloor` anropar klippning korrekt |

---

## Tekniska detaljer

### xeokit SectionPlane beteende
- `dir: [0, -1, 0]` betyder att planet pekar neråt
- Objekt **i riktningen av pilen** klipps bort (osynliga)
- Så ett plan på Y=10 med dir neråt klipper allt ovanför Y=10

### Asset+ onShowSpacesChanged
- Metod på `viewer.assetViewer`
- Kontrollerar synlighet för alla IfcSpace-objekt globalt
- Vi måste komplettera med egen filtrering per våningsplan

### Våningsgräns-beräkning
- Sortera storeys efter minY (elevation)
- Klipphöjd för storey[n] = storey[n+1].minY
- Översta våningen: klipp vid egen maxY + liten offset

---

## Förväntade resultat

1. **"Visa rum" alltid AV** - Som standard och efter modell/våningsbyte
2. **Korrekt våningsfiltrering** - Endast rum från valda våningsplan visas
3. **Klippning vid våningsgräns** - Väggar klipps vid nästa vånings golv, inte vid geometri-max
4. **Fungerande 2D-slider** - Klipphöjden uppdateras i realtid
5. **IfcCovering döljs** - I Solo-mode (redan implementerat)
