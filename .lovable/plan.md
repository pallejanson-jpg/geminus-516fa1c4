
# Plan: Synkronisera Våningsväljare, Fixa 2D-klippning & Split View

## Sammanfattning

Denna plan adresserar sex problem i 3D-visaren:
1. **Våningsväljarna hänger inte ihop** - Modellträdet, Pills, Menyväljaren och Karusellen styr inte samma val
2. **Pills ska vara vertikal, draggbar och vid höger meny** - Med toggle i Viewer settings
3. **Skapa ärenden ska vara flytande** - Redan implementerat (CreateIssueDialog är draggbar)
4. **Modellträdet behöver längre standardhöjd** - 400px → 550px
5. **2D-klippfunktionen fungerar inte** - SectionPlane kräver `clippable: true` på entities
6. **Split View synk-problem** - Startvy, klipp av objekt ovanför nästa våningsplan, och 360→våning-hopp

---

## Del 1: Synkronisera Våningsväljare

### Problem
- `ViewerTreePanel` ändrar synlighet direkt i scengrafen men skickar INTE `FLOOR_SELECTION_CHANGED_EVENT`
- `FloatingFloorSwitcher` lyssnar på eventet men uppdaterar inte sin selection vid multi-select från andra källor
- `FloorCarousel` skickar event vid klick men lyssnar inte för att synka sin markering

### Lösning

```text
┌────────────────────────────────────────────────────────────────┐
│               Unified Floor Selection Architecture             │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   ViewerTreePanel ──┐                                          │
│                     │                                          │
│   FloorVisibility ──┼──▶ FLOOR_SELECTION_CHANGED_EVENT ──┐     │
│                     │                                    │     │
│   FloatingPills ────┤                                    ▼     │
│                     │                              ┌──────────┐│
│   FloorCarousel ────┘                              │ Listeners ││
│                                                    └──────────┘│
│                                                         │      │
│   All components BOTH dispatch AND listen to this event │      │
│   ────────────────────────────────────────────────────────     │
└────────────────────────────────────────────────────────────────┘
```

### Filer att ändra

| Fil | Ändring |
|-----|---------|
| `src/components/viewer/ViewerTreePanel.tsx` | Dispatcha FLOOR_SELECTION_CHANGED_EVENT vid storey-nod visibility toggle |
| `src/components/viewer/FloatingFloorSwitcher.tsx` | Uppdatera `visibleFloorIds` state vid mottagning av event (stödja multi-select) |
| `src/components/viewer/FloorCarousel.tsx` | Lägg till listener för att synka `selectedFloorId` |

### Ändringar i ViewerTreePanel

När en storey-nod ändrar synlighet:

```typescript
const handleVisibilityChange = useCallback((node: TreeNode, visible: boolean) => {
  // ... existing visibility logic ...
  
  // If node is IfcBuildingStorey, dispatch floor selection event
  if (node.type?.toLowerCase() === 'ifcbuildingstorey') {
    // Collect all currently visible storeys
    const visibleStoreys = getAllVisibleStoreys(scene, metaObjects);
    
    window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
      detail: {
        floorId: visibleStoreys.length === 1 ? visibleStoreys[0].id : null,
        visibleMetaFloorIds: visibleStoreys.map(s => s.id),
        visibleFloorFmGuids: visibleStoreys.map(s => s.originalSystemId || s.id),
        isAllFloorsVisible: visibleStoreys.length === allStoreys.length,
      }
    }));
  }
}, []);
```

### Ändringar i FloatingFloorSwitcher

Uppdatera listener för att hantera full synk:

```typescript
useEffect(() => {
  const handleFloorChange = (e: CustomEvent<FloorSelectionEventDetail>) => {
    const { visibleMetaFloorIds, isAllFloorsVisible } = e.detail;
    
    if (isAllFloorsVisible) {
      setVisibleFloorIds(new Set(floors.map(f => f.id)));
    } else if (visibleMetaFloorIds && visibleMetaFloorIds.length > 0) {
      // Match against our floor list
      const matchingIds = floors
        .filter(f => visibleMetaFloorIds.includes(f.id))
        .map(f => f.id);
      setVisibleFloorIds(new Set(matchingIds));
    }
  };
  
  window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorChange);
  return () => window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorChange);
}, [floors]);
```

---

## Del 2: Vertikal Draggbar Pills vid Höger Meny

### Nuvarande
- Horisontell, fixed i bottom-left
- Inte konfigurerbar via settings

### Önskad
- Vertikal layout
- Draggbar
- Default-position: höger (vid VisualizationToolbar)
- Toggle i Viewer Settings (maximera-knappen i Visningsmenyn)

### Filer att ändra

| Fil | Ändring |
|-----|---------|
| `src/components/viewer/FloatingFloorSwitcher.tsx` | Ny layout (vertical), draggbar, läs show/hide från localStorage |
| `src/components/viewer/VisualizationToolbar.tsx` | Lägg till Switch "Visa våningsväljare" under Viewer settings |
| `src/components/viewer/ToolbarSettings.tsx` | (Valfritt) Lägg till som konfigurerbart verktyg |

### FloatingFloorSwitcher ändringar

```typescript
// State for dragging
const [position, setPosition] = useState({ x: 0, y: 0 });
const [isDragging, setIsDragging] = useState(false);

// Check visibility from localStorage or context
const [isVisible, setIsVisible] = useState(() => {
  return localStorage.getItem('viewer-show-floor-pills') !== 'false'; // Default ON
});

// Listen for visibility toggle events
useEffect(() => {
  const handleToggle = (e: CustomEvent) => {
    setIsVisible(e.detail.visible);
    localStorage.setItem('viewer-show-floor-pills', String(e.detail.visible));
  };
  window.addEventListener('FLOOR_PILLS_TOGGLE', handleToggle);
  return () => window.removeEventListener('FLOOR_PILLS_TOGGLE', handleToggle);
}, []);

// Initial position - right side
useEffect(() => {
  if (position.x === 0 && position.y === 0) {
    const x = window.innerWidth - 80; // Near right edge
    const y = 150; // Below header
    setPosition({ x, y });
  }
}, []);

// Render vertically
return (
  <div
    style={{ left: position.x, top: position.y }}
    className={cn(
      'fixed z-20 flex flex-col items-center gap-1 p-2',
      'bg-background/80 backdrop-blur-sm border rounded-lg shadow-lg',
      !isVisible && 'hidden',
      isDragging && 'cursor-grabbing'
    )}
    onMouseDown={handleDragStart}
  >
    {/* Drag handle */}
    <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
    
    {/* Vertical pills */}
    {floors.map(floor => (
      <button key={floor.id} className="w-10 h-10 rounded-full ...">
        {floor.shortName}
      </button>
    ))}
  </div>
);
```

### VisualizationToolbar toggle

Under "Viewer settings" collapsible:

```tsx
<div className="flex items-center justify-between">
  <Label>Visa våningsväljare</Label>
  <Switch
    checked={showFloorPills}
    onCheckedChange={(show) => {
      setShowFloorPills(show);
      window.dispatchEvent(new CustomEvent('FLOOR_PILLS_TOGGLE', {
        detail: { visible: show }
      }));
    }}
  />
</div>
```

---

## Del 3: Längre Modellträd som Standard

### Nuvarande
Default height: 400px → många våningar får inte plats

### Ändring

```typescript
// ViewerTreePanel.tsx line 338
const [size, setSize] = useState({ width: 320, height: 550 }); // Was 400
```

---

## Del 4: Fixa 2D-klippning (SectionPlane)

### Problem (från xeokit-dokumentation)
SectionPlanes klipper ENDAST entities som har `clippable: true`. Standard i xeokit är `true`, men Asset+-bundlen kan sätta det annorlunda.

### Lösning
Säkerställ att alla entities har `clippable: true` innan SectionPlane appliceras.

### xeokit SectionPlane API-dokumentation (sammanfattning)

```javascript
// KORREKT: dir pekar mot den kasserade sidan
// [0, 1, 0] = UP = kastera allt OVANFÖR planet
// [0, -1, 0] = DOWN = kastera allt NEDANFÖR planet

const sectionPlane = new SectionPlane(scene, {
  id: "myPlane",
  pos: [0, 5, 0],   // Y = 5 meter
  dir: [0, 1, 0],   // Discard above
  active: true
});

// Entity måste ha clippable: true
entity.clippable = true; // default är true men kan vara override
```

### Filer att ändra

| Fil | Ändring |
|-----|---------|
| `src/hooks/useSectionPlaneClipping.ts` | Sätt `clippable: true` på ALLA scene objects innan klippning |

### Ny funktion: ensureClippable

```typescript
/**
 * Ensure all entities in the scene are clippable.
 * Required for SectionPlanes to work correctly.
 */
const ensureAllEntitiesClippable = useCallback(() => {
  const viewer = getXeokitViewer();
  if (!viewer?.scene?.objects) return;
  
  const objects = viewer.scene.objects;
  let count = 0;
  
  Object.values(objects).forEach((entity: any) => {
    if (entity && entity.clippable === false) {
      entity.clippable = true;
      count++;
    }
  });
  
  if (count > 0) {
    console.log(`[SectionPlane] Enabled clippable on ${count} entities`);
  }
}, [getXeokitViewer]);
```

Anropas i `applyFloorPlanClipping` och `applyCeilingClipping` innan plane skapas.

### Objekt högre än nästa våning (felritade)

Lösning: 3D Solo mode ska använda nästa vånings `minY` som klipphöjd istället för aktuell vånings `maxY`. Detta är redan implementerat i `calculateClipHeightFromFloorBoundary` men måste säkerställas att den verkligen används.

---

## Del 5: Fixa Split View Synkronisering

### Problem 1: Startvy saknas
360 styr start (användarvalet) men idag sker ingen initial synk.

### Problem 2: Redundanta props
`syncPosition`, `syncHeading`, `syncPitch` i AssetPlusViewer är **oanvända** - de passas ner men läses aldrig.

### Problem 3: Ivion postMessage-synk fungerar ej
`useIvionCameraSync` lyssnar på `navvis-event` med `camera-changed` men Ivion kanske inte skickar det i rätt format.

### Lösning

```text
┌─────────────────────────────────────────────────────────────────┐
│                     Split View Sync Flow                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. SplitViewer öppnas                                          │
│  2. Ivion360View laddas i iframe                                │
│  3. Ivion skickar 'navvis-event' camera-changed                 │
│  4. useIvionCameraSync fångar → updateFromIvion(pos, heading)   │
│  5. syncState.source = 'ivion' → SplitViewer useEffect triggas  │
│  6. Antingen:                                                   │
│     a) SplitViewer skickar till AssetPlusViewer via             │
│        useViewerCameraSync onSyncReceived callback              │
│     b) ELLER: Ta bort mellanhand, låt AssetPlusViewer lyssna    │
│        direkt på syncState                                      │
│                                                                 │
│  Implementera (b) - enklare och redan delvis på plats           │
└─────────────────────────────────────────────────────────────────┘
```

### Filer att ändra

| Fil | Ändring |
|-----|---------|
| `src/hooks/useIvionCameraSync.ts` | Lägg till mer robust message-parsing och fallback |
| `src/components/viewer/AssetPlusViewer.tsx` | Ta bort oanvända `syncPosition/syncHeading/syncPitch` props, förlita på useViewerCameraSync |
| `src/pages/SplitViewer.tsx` | Ta bort redundant state-mellanhand |
| `src/components/viewer/Ivion360View.tsx` | Lägg till debug-loggning för inkommande postMessages |

### Initialsynk från 360

Lägg till i `useIvionCameraSync`:

```typescript
// After first message received, set initialSyncDone flag
const initialSyncDoneRef = useRef(false);

// In message handler:
if (!initialSyncDoneRef.current && data?.data?.lat) {
  console.log('[Ivion Sync] Initial position received');
  initialSyncDoneRef.current = true;
  // Force broadcast to 3D viewer
}
```

---

## Del 6: 360 till Rätt Våning via Geo

### Nuvarande
Ingen logik för att skicka startposition till Ivion baserat på vald våning.

### Lösning
När 360-vy öppnas med en förselekterad våning, beräkna våningens centroid i geo-koordinater och skicka `moveToGeoLocation` till Ivion.

### Filer att ändra

| Fil | Ändring |
|-----|---------|
| `src/context/AppContext.tsx` | Utöka `Ivion360Context` med `initialFloorFmGuid` |
| `src/components/viewer/Ivion360View.tsx` | Vid mount, om `initialFloorFmGuid` finns, hämta floor bounds → geo → postMessage |

### Ivion360View tillägg

```typescript
// After iframe loaded and token validated
useEffect(() => {
  const initialFloor = ivion360Context?.initialFloorFmGuid;
  if (!initialFloor || !buildingOrigin || !iframeRef.current?.contentWindow) return;
  
  // Fetch floor centroid from 3D model data (via AppContext.allData)
  const floor = allData.find(a => 
    a.fmGuid === initialFloor && a.category === 'Building Storey'
  );
  
  if (floor?.centroid) { // If we have cached centroid
    const geo = localToGeo(floor.centroid, buildingOrigin);
    
    iframeRef.current.contentWindow.postMessage({
      type: 'navvis-command',
      action: 'moveToGeoLocation',
      params: { lat: geo.lat, lng: geo.lng, heading: 0 }
    }, '*');
  }
}, [ivion360Context?.initialFloorFmGuid, buildingOrigin, isLoading]);
```

---

## Prioritetsordning

| Prio | Åtgärd | Beskrivning |
|------|--------|-------------|
| 1 | 2D-klippning | Sätt `clippable: true` - kritiskt för all klipplogik |
| 2 | Våningssynk | ViewerTreePanel skickar event + alla lyssnar |
| 3 | Split View startvy | 360 → 3D synk vid öppning |
| 4 | Pills vertikal | Layout + draggbar + toggle |
| 5 | Modellträd höjd | Enkel ändring |
| 6 | 360 våningshopp | Geo-baserad initial navigation |

---

## Tekniska Detaljer

### xeokit SectionPlane Korrekt Användning

```javascript
// Metod 1: Via scene (rekommenderad)
const plane = new viewer.scene.SectionPlane(viewer.scene, {
  id: 'floor-clip',
  pos: [0, height, 0],
  dir: [0, 1, 0], // Kastera ovanför
  active: true
});

// Metod 2: Via scene.sectionPlanes registry
viewer.scene.sectionPlanes['myPlane'] = new SectionPlane(...);

// KRITISKT: Entity.clippable måste vara true
Object.values(scene.objects).forEach(e => e.clippable = true);
```

### NavVis Ivion postMessage API

```javascript
// Lyssna på kamera-ändringar
window.addEventListener('message', (e) => {
  if (e.data?.type === 'navvis-event' && e.data?.event === 'camera-changed') {
    const { lat, lng, heading, pitch } = e.data.data;
    // ...
  }
});

// Skicka navigeringskommando
iframe.contentWindow.postMessage({
  type: 'navvis-command',
  action: 'moveToGeoLocation',
  params: { lat, lng, heading, pitch }
}, '*');
```

### Event Flow Diagram

```text
User clicks floor in ViewerTreePanel
          │
          ▼
ViewerTreePanel.handleVisibilityChange()
          │
          ├─── scene.objects[id].visible = true/false
          │
          └─── dispatch FLOOR_SELECTION_CHANGED_EVENT
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
  FloatingFloorSwitcher  FloorCarousel  AssetPlusViewer
  (updates pills state)  (updates       (filters spaces,
                         selection)     labels, viz)
```

---

## Filer som ändras (sammanfattning)

1. `src/hooks/useSectionPlaneClipping.ts` - clippable fix
2. `src/components/viewer/ViewerTreePanel.tsx` - event dispatch + height
3. `src/components/viewer/FloatingFloorSwitcher.tsx` - vertikal, draggbar, listener
4. `src/components/viewer/FloorCarousel.tsx` - listener
5. `src/components/viewer/VisualizationToolbar.tsx` - pills toggle
6. `src/hooks/useIvionCameraSync.ts` - robust parsing
7. `src/components/viewer/Ivion360View.tsx` - initial floor navigation
8. `src/components/viewer/AssetPlusViewer.tsx` - cleanup unused props
9. `src/pages/SplitViewer.tsx` - cleanup redundant state
10. `src/context/AppContext.tsx` - extend Ivion360Context

