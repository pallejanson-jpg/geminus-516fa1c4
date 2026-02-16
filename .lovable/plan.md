

## Fixa vningsplan-konflikter, Solo-buggar och rumsvisualisering

### Problem och rotorsaker

**1. Flytande vaningsvaljare krockar med hogermenyns vaningsvaljare**
Bada komponenterna (FloatingFloorSwitcher och FloorVisibilitySelector) lyssnar pa samma FLOOR_SELECTION_CHANGED_EVENT och bada applicerar `applyFloorVisibility` pa viewern. De har egna kopior av floor-state och kan hamna ur synk, sarskilt vid snabba klick.

**2. Solo-knappen slacker ibland hela 3D-vyn**
I `FloorVisibilitySelector.applyFloorVisibility` (rad 359-386) kors `scene.setObjectsVisible(scene.objectIds, false)` forst, sedan `scene.setObjectsVisible(idsToShow, true)`. Om `idsToShow` ar tomt (t.ex. for att `childrenMapCache` inte byggts klart annu, eller floors-state ar tom) sa doljs allt utan att nagon geometri aterstalls.

**3. Dubbel "Rumsvisualisering"-rubrik**
I `ViewerRightPanel` rad 577 star "Rumsvisualisering" som collapsible-header. Nar man vecklar ut den renderas `RoomVisualizationPanel` i embedded-lage, som pa rad 665-669 ocksa visar en header med "Rumsvisualisering".

**4. Rum fargas inte om vid byte av visualiseringstyp**
`applyVisualization` (rad 387-447) har en guard `if (isProcessing) return;` pa rad 393. Nar man byter fran t.ex. Temperatur till Luftfuktighet triggas `useEffect` pa rad 450, men om foregaende chunk-bearbetning inte hunnit saetta `isProcessing = false` (via requestIdleCallback) sa blockeras den nya visualiseringen helt. Dessutom anropas `resetColors` fran effekten (rad 452-454 for `none`-fallet), men for byte mellan tva aktiva typer kors istallet `applyVisualization` som gor en intern reset -- men bara om `isProcessing` ar false.

**5. Legendens klick gor ingenting**
Koden i `handleLegendSelect` (rad 503-558) anvander X-ray-strategi men problemet ar att den bara aktiveras om `type === visualizationType`, och `rooms`-arrayen kan vara tom om filtreringen inte stammer. Dessutom om `idsToSelect` ar 0 (inga matchande rum) sa togglas X-ray av (rad 552-558) utan visuell feedback. Funktionen i sig ar korrekt, men den misslyckas tyst nar rum-data inte matchar.

**6. Byte av vaningsplan med aktiv visualisering slacker allt**
Nar Solo klickas i FloorVisibilitySelector kors `applyFloorVisibility` som satter `scene.setObjectsVisible(scene.objectIds, false)` och sedan visar enbart den nya vaningens barn-objekt. RoomVisualizationPanel lyssnar pa FLOOR_SELECTION_CHANGED_EVENT och uppdaterar `eventFloorGuids`, vilket triggar ny filtrering av rum och ny `applyVisualization`. Men det finns en race condition: floor-vaxlingen doljer alla objekt (inklusive IfcSpace), och sedan forsaker applyVisualization farglagga rum som just gjorts osynliga. Visualiseringen appliceras via requestIdleCallback som kors EFTER att floor-visibility redan slagit.

---

### Plan

#### Steg 1: Dolj FloatingFloorSwitcher

**Fil:** `src/components/viewer/FloatingFloorSwitcher.tsx`

Andring: Satt `isVisible` default till `false` och localStorage-varde till `'false'` sa att den ar dold fran start. Behalj toggle-logiken i ViewerRightPanel (Viewer Settings > "Vaningsvaljare (pills)") sa att anvandaren kan aktivera den manuellt om de vill.

```typescript
const [isVisible, setIsVisible] = useState(() => {
  return localStorage.getItem('viewer-show-floor-pills') === 'true'; // Changed from !== 'false'
});
```

#### Steg 2: Fixa Solo-mode som ibland slacker 3D

**Fil:** `src/components/viewer/FloorVisibilitySelector.tsx`

Andring i `applyFloorVisibility`: Lagg till en skerhetskontroll som forhindrar att alla objekt doljs om `idsToShow` ar tom. Om inga barn-objekt hittas, avbryt operationen istallet for att dolja allt.

```typescript
const applyFloorVisibility = useCallback((visibleIds: Set<string>) => {
  const viewer = getXeokitViewer();
  if (!viewer?.scene) return;

  const scene = viewer.scene;
  const childrenMap = buildChildrenMap();
  const isSoloMode = visibleIds.size === 1;
  
  const idsToShow: string[] = [];
  
  floors.forEach(floor => {
    if (visibleIds.has(floor.id)) {
      floor.metaObjectIds.forEach(metaObjId => {
        idsToShow.push(...getChildIdsOptimized(metaObjId, childrenMap));
      });
    }
  });
  
  // SAFETY: Abort if no objects to show -- prevents blacking out
  if (idsToShow.length === 0) {
    console.warn('applyFloorVisibility: no objects found for selected floors, aborting');
    return;
  }
  
  // ... rest of existing logic
}, [...]);
```

Samma fix appliceras i `FloatingFloorSwitcher.applyFloorVisibility` for konsistens (aven om den doljs -- kan ateraktiveras).

#### Steg 3: Ta bort dubbel "Rumsvisualisering"-rubrik

**Fil:** `src/components/viewer/RoomVisualizationPanel.tsx`

Ta bort den inre headern i embedded-laget (rad 665-669):

```typescript
// REMOVE this block in contentJSX:
{embedded && (
  <div className="flex items-center gap-2 mb-1">
    <Palette className="h-4 w-4 text-primary" />
    <span className="font-medium text-sm">Rumsvisualisering</span>
  </div>
)}
```

#### Steg 4: Fixa rumsvisualisering som inte uppdateras vid typbyte

**Fil:** `src/components/viewer/RoomVisualizationPanel.tsx`

Rotorsak: `isProcessing`-guarden i `applyVisualization` blockerar ny applicering nar foregaende batch annu inte slutforts. 

Fix:
1. Lagg till en `cancelRef` som avbryter pagaende chunk-bearbetning nar en ny visualiseringstyp valjs.
2. Ta bort `isProcessing`-guarden fran `applyVisualization` och anvand istallet cancel-mekanismen.

```typescript
const cancelRef = useRef(false);

const applyVisualization = useCallback(() => {
  if (visualizationType === 'none') {
    resetColors();
    return;
  }

  // Cancel any in-progress chunking
  cancelRef.current = true;
  
  // Reset before applying new colors
  colorizedRoomGuidsRef.current.forEach((fmGuid) => {
    colorizeSpace(fmGuid, null);
  });
  colorizedRoomGuidsRef.current.clear();
  
  setIsProcessing(true);
  cancelRef.current = false; // Reset cancel flag for new run

  let count = 0;
  const CHUNK_SIZE = 30;
  const chunks: RoomData[][] = [];
  for (let i = 0; i < rooms.length; i += CHUNK_SIZE) {
    chunks.push(rooms.slice(i, i + CHUNK_SIZE));
  }

  const processChunk = (chunkIndex: number) => {
    if (cancelRef.current || chunkIndex >= chunks.length) {
      setColorizedCount(count);
      setIsProcessing(false);
      return;
    }
    // ... existing chunk processing ...
  };

  processChunk(0);
}, [visualizationType, rooms, useMockData, colorizeSpace, resetColors]);
```

Och i useEffect (rad 450-482), ta bort `isProcessing` fran dependency-kontrollen och anropa `applyVisualization` direkt:

```typescript
useEffect(() => {
  if (visualizationType === 'none') {
    resetColors();
    return;
  }
  // Force show spaces
  window.dispatchEvent(new CustomEvent(FORCE_SHOW_SPACES_EVENT, { detail: { show: true } }));
  if (onShowSpaces) onShowSpaces(true);

  // Retry until cache and rooms are ready
  let cancelled = false;
  const applyWithRetry = (attempt: number) => {
    if (cancelled) return;
    if (entityIdCache.size > 0 && rooms.length > 0) {
      applyVisualization();
    } else if (attempt < 5) {
      setTimeout(() => applyWithRetry(attempt + 1), 400);
    }
  };
  const timer = setTimeout(() => applyWithRetry(0), 250);
  return () => { cancelled = true; clearTimeout(timer); };
}, [visualizationType, useMockData, rooms.length, entityIdCache.size]);
```

#### Steg 5: Fixa legendklick sa att rum faktiskt markeras

**Fil:** `src/components/viewer/RoomVisualizationPanel.tsx`

Problemet ar att `handleLegendSelect` anvander x-ray-strategi men nar rummen redan ar fargkodade sa fungerar inte `setObjectsSelected` visuellt. Rummen forsvinner bakom x-ray istallet for att framhavas.

Fix: Nar inga rum matchas (idsToSelect === 0), aterstaell xray. Nar rum matchas:
1. Satt X-ray pa allt
2. Stang av X-ray OCH applicera fargerna pa matchande rum (de ar redan farglagda fran visualiseringen)
3. Se till att `scene.alphaDepthMask = false` satts FORE `setObjectsXRayed` (redan korrekt men kan raceas)

Lagg ocksa till en tydligare toggle: andra klick pa samma legend-stopp ska aterstaella (ta bort x-ray). Lagg till en `activeLegenRange`-ref:

```typescript
const activeLegendRangeRef = useRef<{min: number, max: number} | null>(null);

// In handleLegendSelect:
if (rangeMin === activeLegendRangeRef.current?.min && 
    rangeMax === activeLegendRangeRef.current?.max) {
  // Toggle off
  scene.setObjectsXRayed(allIds, false);
  activeLegendRangeRef.current = null;
  return;
}
activeLegendRangeRef.current = { min: rangeMin, max: rangeMax };
```

#### Steg 6: Fixa vaningsplansbyte med aktiv visualisering

**Fil:** `src/components/viewer/FloorVisibilitySelector.tsx`

Problemet ar att `applyFloorVisibility` doljer IfcSpace-objekt (via `scene.setObjectsVisible(scene.objectIds, false)`), och sedan satter bara barnens synlighet. Men RoomVisualizationPanel forsaker farglagga IfcSpace-objekt som just dolts.

Fix: I `applyFloorVisibility`, efter att synlighet applicerats, dispatcha ett nytt event (`FLOOR_VISIBILITY_APPLIED`) som RoomVisualizationPanel kan lyssna pa for att veta att det ar sakert att re-applicera farger.

```typescript
// After visibility is applied in applyFloorVisibility:
window.dispatchEvent(new CustomEvent('FLOOR_VISIBILITY_APPLIED'));
```

I `RoomVisualizationPanel`, lagg till en lyssnare:

```typescript
useEffect(() => {
  const handler = () => {
    if (visualizationType !== 'none' && rooms.length > 0) {
      // Re-apply colors after floor visibility has settled
      setTimeout(() => applyVisualization(), 100);
    }
  };
  window.addEventListener('FLOOR_VISIBILITY_APPLIED', handler);
  return () => window.removeEventListener('FLOOR_VISIBILITY_APPLIED', handler);
}, [visualizationType, rooms.length, applyVisualization]);
```

---

### Sammanfattning

| Steg | Fil | Andring |
|------|-----|---------|
| 1 | FloatingFloorSwitcher.tsx | Default-dolj pills |
| 2 | FloorVisibilitySelector.tsx | Sakerhetskontroll i applyFloorVisibility |
| 3 | RoomVisualizationPanel.tsx | Ta bort dubbel rubrik |
| 4 | RoomVisualizationPanel.tsx | Cancel-mekanism for chunk-bearbetning |
| 5 | RoomVisualizationPanel.tsx | Fixa legend-toggle och xray-hantering |
| 6 | FloorVisibilitySelector.tsx + RoomVisualizationPanel.tsx | Synkronisera floor-visibility med re-colorization |

