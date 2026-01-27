
# Plan: Implementera 2D-planritningsklippning med SectionPlane

## Sammanfattning

Utöka befintlig SectionPlane-klippning för att stödja 2D-planritningsvy där klippningen sker ~1.2m ovanför golvet istället för vid taket. Detta ger en ren planritningsvy där väggar ses som linjer och tak/höga objekt klipps bort.

## Teknisk analys

### Nuvarande implementation
- `useSectionPlaneClipping.ts` - Klipper vid `bounds.maxY + offset` (taknivå)
- `ViewerToolbar.tsx` - 2D-läge byter endast kameraprojektion till ortografisk
- `FloorVisibilitySelector.tsx` - Använder hooken för taknivå-klippning vid "Solo"

### Önskad implementation
- **3D Solo-läge:** Klippning vid taknivå (nuvarande beteende)
- **2D-läge:** Klippning ~1.2m ovanför golvet (nytt)
- **Rumsvisualisering:** Ska fungera korrekt med båda klipplägena

## Ändringar

### 1. useSectionPlaneClipping.ts - Lägg till stöd för `clipMode`

Utöka hooken med:
- `clipMode: 'ceiling' | 'floor'` parameter
- `floorCutHeight: number` parameter (default 1.2m)
- Ny funktion `applyFloorPlanClipping(floorId)` för 2D-läge

```typescript
interface SectionPlaneClippingOptions {
  enabled?: boolean;
  offset?: number;
  clipMode?: 'ceiling' | 'floor';  // NY
  floorCutHeight?: number;         // NY - höjd ovanför golv för 2D (default 1.2m)
}

// I applySectionPlane:
const clipHeight = options.clipMode === 'floor' 
  ? bounds.minY + (options.floorCutHeight || 1.2)  // Planritningsvy
  : bounds.maxY + offset;                           // Taknivå
```

### 2. ViewerToolbar.tsx - Koppla 2D-knappen till SectionPlane

Lägg till:
- Import av `useSectionPlaneClipping`
- Hålla reda på valt våningsplan via custom event
- Aktivera planritningsklippning när 2D-läge aktiveras

```typescript
// State för att spåra valt floor
const [currentFloorId, setCurrentFloorId] = useState<string | null>(null);

// Lyssna på floor-ändringar
useEffect(() => {
  const handleFloorChange = (e: CustomEvent) => {
    setCurrentFloorId(e.detail.floorId);
  };
  window.addEventListener('FLOOR_SELECTION_CHANGED', handleFloorChange);
  return () => window.removeEventListener('FLOOR_SELECTION_CHANGED', handleFloorChange);
}, []);

// I handleViewModeChange:
if (mode === '2d' && currentFloorId) {
  apply2DFloorClipping(currentFloorId);
}
```

### 3. FloorVisibilitySelector.tsx - Emittera floor-ändringar

Lägg till custom event när våning ändras så ViewerToolbar kan lyssna:

```typescript
const handleShowOnlyFloor = useCallback((floorId: string) => {
  // ... befintlig logik ...
  
  // Emittera event för andra komponenter (t.ex. ViewerToolbar 2D-läge)
  window.dispatchEvent(new CustomEvent('FLOOR_SELECTION_CHANGED', { 
    detail: { floorId, floorBounds: calculateFloorBounds(floorId) }
  }));
}, []);
```

### 4. Synkronisering mellan komponenter

Skapa ett enkelt event-baserat kommunikationsmönster:

```text
FloorVisibilitySelector                    ViewerToolbar
       │                                        │
       │ -- FLOOR_SELECTION_CHANGED ──────────► │
       │    (floorId, bounds)                   │
       │                                        │
       │ ◄───── VIEW_MODE_CHANGED ───────────── │
       │        (mode: '2d' | '3d')             │
       │                                        │
       ▼                                        ▼
   useSectionPlaneClipping              useSectionPlaneClipping
   (clipMode: 'ceiling')                (clipMode: 'floor')
```

## Detaljerade filändringar

### useSectionPlaneClipping.ts

```typescript
// Nya options
interface SectionPlaneClippingOptions {
  enabled?: boolean;
  offset?: number;
  clipMode?: 'ceiling' | 'floor';
  floorCutHeight?: number;  // Default 1.2m
}

// Uppdaterad applySectionPlane
const applySectionPlane = useCallback((floorId: string, mode?: 'ceiling' | 'floor') => {
  const clipMode = mode || options.clipMode || 'ceiling';
  const bounds = calculateFloorBounds(floorId);
  
  // Beräkna klipphöjd baserat på läge
  const clipHeight = clipMode === 'floor' 
    ? bounds.minY + (options.floorCutHeight || 1.2)
    : bounds.maxY + offset;
  
  // Skapa SectionPlane vid rätt höjd
  sectionPlaneRef.current = plugin.createSectionPlane({
    id: `floor-clip-${floorId}-${clipMode}`,
    pos: [0, clipHeight, 0],
    dir: [0, -1, 0],
    active: true,
  });
}, [/* deps */]);

// Ny funktion för 2D-läge
const applyFloorPlanClipping = useCallback((floorId: string) => {
  applySectionPlane(floorId, 'floor');
}, [applySectionPlane]);

return {
  updateClipping,
  applySectionPlane,
  applyFloorPlanClipping,  // NY
  removeSectionPlane,
  isClippingActive,
  currentFloorId,
  currentClipMode,  // NY
};
```

### ViewerToolbar.tsx

```typescript
// Importera hooken
import { useSectionPlaneClipping } from '@/hooks/useSectionPlaneClipping';

// I komponenten:
const [currentFloorId, setCurrentFloorId] = useState<string | null>(null);

const { applyFloorPlanClipping, removeSectionPlane } = useSectionPlaneClipping(
  viewerRef, 
  { enabled: true, clipMode: 'floor', floorCutHeight: 1.2 }
);

// Lyssna på floor-ändringar
useEffect(() => {
  const handleFloorChange = (e: CustomEvent) => {
    setCurrentFloorId(e.detail.floorId);
    // Om 2D-läge är aktivt, uppdatera klippningen
    if (viewMode === '2d' && e.detail.floorId) {
      applyFloorPlanClipping(e.detail.floorId);
    }
  };
  window.addEventListener('FLOOR_SELECTION_CHANGED', handleFloorChange as EventListener);
  return () => window.removeEventListener('FLOOR_SELECTION_CHANGED', handleFloorChange as EventListener);
}, [viewMode, applyFloorPlanClipping]);

// Uppdaterad handleViewModeChange
const handleViewModeChange = useCallback((mode: ViewMode) => {
  setViewMode(mode);
  
  if (mode === '2d') {
    // Applicera planritningsklippning om ett våningsplan är valt
    if (currentFloorId) {
      applyFloorPlanClipping(currentFloorId);
    }
    
    // Flytta kamera ovanifrån (befintlig logik)
    // ...
  } else {
    // Ta bort 2D-klippningen
    removeSectionPlane();
    // Återställ kamera (befintlig logik)
    // ...
  }
}, [currentFloorId, applyFloorPlanClipping, removeSectionPlane]);
```

### FloorVisibilitySelector.tsx

```typescript
// I handleShowOnlyFloor - emittera event
const handleShowOnlyFloor = useCallback((floorId: string) => {
  const newSet = new Set([floorId]);
  setVisibleFloorIds(newSet);
  applyFloorVisibility(newSet);
  updateClipping([floorId]);
  
  // Emittera event för ViewerToolbar och andra lyssnare
  const bounds = calculateFloorBounds(floorId);
  window.dispatchEvent(new CustomEvent('FLOOR_SELECTION_CHANGED', { 
    detail: { 
      floorId, 
      floorName: floors.find(f => f.id === floorId)?.name,
      bounds 
    }
  }));
  
  // ... resten av befintlig logik
}, [/* deps */]);

// I handleShowAll - emittera att ingen specifik våning är vald
const handleShowAll = useCallback(() => {
  // ... befintlig logik ...
  
  window.dispatchEvent(new CustomEvent('FLOOR_SELECTION_CHANGED', { 
    detail: { floorId: null, floorName: null, bounds: null }
  }));
}, [/* deps */]);

// Lägg till beräkningsfunktion
const calculateFloorBounds = useCallback((floorId: string) => {
  const viewer = getXeokitViewer();
  if (!viewer?.metaScene?.metaObjects || !viewer?.scene?.objects) return null;
  
  const floor = floors.find(f => f.id === floorId);
  if (!floor) return null;
  
  let minY = Infinity, maxY = -Infinity;
  const childrenMap = buildChildrenMap();
  
  floor.metaObjectIds.forEach(metaObjId => {
    const ids = getChildIdsOptimized(metaObjId, childrenMap);
    ids.forEach(id => {
      const entity = viewer.scene.objects?.[id];
      if (entity?.aabb) {
        if (entity.aabb[1] < minY) minY = entity.aabb[1];
        if (entity.aabb[4] > maxY) maxY = entity.aabb[4];
      }
    });
  });
  
  return { minY, maxY };
}, [getXeokitViewer, floors, buildChildrenMap, getChildIdsOptimized]);
```

## Rumsvisualisering

Rumsvisualiseringen (`RoomVisualizationPanel`) fungerar genom att sätta `entity.colorize` på rum-objekt (IfcSpace). Dessa rum är 3D-volymer i modellen.

**Varför det fungerar med klippning:**
- När SectionPlane klipper vid 1.2m höjd, visas fortfarande den nedre delen av rummen
- Rummens golv och nedre väggar behåller sin färgkodning
- Resultatet blir en färglagd planritningsvy

**Ingen ändring behövs** i `RoomVisualizationPanel.tsx` - den fungerar automatiskt.

## Testscenario

1. Öppna 3D-visaren för en byggnad
2. Aktivera rumsvisualisering (t.ex. temperatur)
3. Välj "Solo" för ett våningsplan
4. Klicka på 2D-knappen i verktygsfältet
5. **Förväntat resultat:**
   - Kameran visar ovanifrån (ortografisk)
   - Väggar syns som linjer (klippta vid 1.2m)
   - Rummen behåller sin färgkodning
   - Tak och höga objekt är borta

## Filer att ändra

| Fil | Ändring |
|-----|---------|
| `src/hooks/useSectionPlaneClipping.ts` | Lägg till `clipMode` och `applyFloorPlanClipping` |
| `src/components/viewer/ViewerToolbar.tsx` | Koppla 2D-knappen till planritningsklippning |
| `src/components/viewer/FloorVisibilitySelector.tsx` | Emittera `FLOOR_SELECTION_CHANGED` event |

## Förväntat resultat

- **2D-vy** ger ren planritning med klippning nära golvet
- **Rumsvisualisering** fungerar korrekt i både 2D och 3D
- **Sax-knappen** fortsätter att ge taknivå-klippning i 3D
- **Synkronisering** mellan våningsval och 2D-läge fungerar automatiskt
