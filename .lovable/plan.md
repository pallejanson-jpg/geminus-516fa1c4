
# Plan: Fixa rum-synlighet, våningsplan-filtrering och verktygsfält-inställningar

## Identifierade problem

Baserat på analys av skärmbilder och kod har jag identifierat tre huvudproblem:

### Problem 1: Rum visas vid första våningsklipp trots att "Visa rum" är avstängt
- **Orsak**: Viewer-komponenten anropar `assetViewer.onToggleAnnotation(true)` vid modell-laddning (rad 467), men kan inte hitta någon explicit kod som aktiverar rum. Problemet kan ligga i Asset+ viewer-paketet som visar spaces som standard när man kör "cutOutFloorsByFmGuid".
- **Lösning**: Explicit deaktivera rum (`onShowSpacesChanged(false)`) efter modelladdning och efter varje floor cutout operation.

### Problem 2: Flera våningsplans rum visas vid Solo-val
- **Orsak**: `FloorVisibilitySelector.applyFloorVisibility()` döljer endast geometriobjekt (solida objekt) baserat på floor-hierarkin, men `RoomVisualizationPanel` filtrerar bara rum när visualiseringen är aktiv. Spaces-synlighet i själva xeokit/Asset+ viewer styrs separat och påverkas inte av floor filtering.
- **Lösning**: När "Solo" klickas måste vi även anropa `onShowSpacesChanged(false)` som standard, och endast aktivera rum för det valda våningsplanet om "Visa rum" är aktivt.

### Problem 3: Fel verktyg i "Anpassa verktygsfält"-dialogen
**Verktyg att ta bort** (dessa finns redan i VisualizationToolbar/Visning-menyn):
- `viewMode` (2D/3D växla)
- `annotations` (Annotationer)
- `addAsset` (Registrera tillgång)
- `bimModels` (BIM-modeller)
- `floors` (Våningsplan)

**Övermenyn kanske fungerar men har UI-problem**:
- Scroll-area kan vara för liten vertikalt
- Verktyg med "inOverflow: true" kanske inte renderas korrekt

---

## Detaljerad implementation

### Del 1: Ta bort dubbletter från ToolbarSettings

**Fil: `src/components/viewer/ToolbarSettings.tsx`**

Ta bort följande från `NAVIGATION_TOOLS`:
- `viewMode` (rad 56)

Ta bort följande från `VISUALIZATION_TOOLS`:
- `annotations` (rad 65)
- `bimModels` (rad 70)
- `floors` (rad 71)
- `addAsset` (rad 74)

Öka `SETTINGS_VERSION` till 5 för att tvinga en reset av localStorage.

```typescript
// Version number - increment when adding new tools to force localStorage update
const SETTINGS_VERSION = 5;

// Navigation tools - shown in the bottom toolbar (interaction & navigation only)
export const NAVIGATION_TOOLS: ToolConfig[] = [
  { id: 'orbit', label: 'Orbit (rotera)', visible: true, inOverflow: false },
  { id: 'firstPerson', label: 'Första person', visible: true, inOverflow: false },
  { id: 'zoomIn', label: 'Zooma in', visible: true, inOverflow: false },
  { id: 'zoomOut', label: 'Zooma ut', visible: true, inOverflow: false },
  { id: 'viewFit', label: 'Anpassa vy', visible: true, inOverflow: false },
  { id: 'resetView', label: 'Återställ vy', visible: true, inOverflow: false },
  { id: 'select', label: 'Välj objekt', visible: true, inOverflow: false },
  { id: 'measure', label: 'Mätverktyg', visible: true, inOverflow: false },
  { id: 'slicer', label: 'Snittplan', visible: true, inOverflow: false },
  // REMOVED: viewMode - exists in VisualizationToolbar
  { id: 'flashOnSelect', label: 'Flash vid markering', visible: true, inOverflow: false },
  { id: 'hoverHighlight', label: 'Hover-highlight', visible: true, inOverflow: false },
];

// Visualization tools - shown in the right sidebar toolbar (view options & toggles)
export const VISUALIZATION_TOOLS: ToolConfig[] = [
  { id: 'xray', label: 'X-ray läge', visible: true, inOverflow: false },
  { id: 'spaces', label: 'Visa/dölj rum', visible: true, inOverflow: false },
  // REMOVED: annotations - exists in VisualizationToolbar (Visa annotationer)
  { id: 'navCube', label: 'Navigationskub', visible: true, inOverflow: false },
  { id: 'minimap', label: 'Minimap', visible: true, inOverflow: false },
  { id: 'treeView', label: 'Modellträd (Navigator)', visible: true, inOverflow: false },
  { id: 'visualization', label: 'Rumsvisualisering', visible: true, inOverflow: false },
  // REMOVED: bimModels - exists in VisualizationToolbar
  // REMOVED: floors - exists in VisualizationToolbar
  { id: 'objectInfo', label: 'Objektinfo (Asset+)', visible: true, inOverflow: false },
  { id: 'properties', label: 'Egenskaper (Lovable)', visible: true, inOverflow: false },
  // REMOVED: addAsset - exists in VisualizationToolbar (Registrera tillgång)
];
```

### Del 2: Säkerställ att rum är dolda som standard

**Fil: `src/components/viewer/AssetPlusViewer.tsx`**

I `handleAllModelsLoaded` callback (runt rad 449-530), lägg till explicit deaktivering av spaces:

```typescript
// Efter models laddats - säkerställ att rum är dolda som standard
try {
  const assetViewer = viewer?.assetViewer;
  if (assetViewer?.onShowSpacesChanged) {
    assetViewer.onShowSpacesChanged(false);
    console.log("Spaces hidden by default");
  }
} catch (e) {
  console.debug("Could not hide spaces:", e);
}
```

### Del 3: Synkronisera rum-synlighet med våningsfiltrering

**Fil: `src/components/viewer/FloorVisibilitySelector.tsx`**

Problemet är att `applyFloorVisibility` bara hanterar objektsynlighet, inte IfcSpace-synlighet. Spaces styrs av `onShowSpacesChanged` på Asset+ viewer-nivå, inte per-floor.

Lösningen är att:
1. Skicka med information om vilka floors som är synliga till VisualizationToolbar
2. VisualizationToolbar anropar `onShowSpacesChanged(true/false)` baserat på selection
3. RoomVisualizationPanel redan filtrerar rätt via `visibleFloorFmGuids` prop

Lägg till en callback i `handleShowOnlyFloor`:
```typescript
const handleShowOnlyFloor = useCallback((floorId: string) => {
  const newSet = new Set([floorId]);
  setVisibleFloorIds(newSet);
  applyFloorVisibility(newSet);
  
  // Apply clipping when showing single floor
  updateClipping([floorId]);
  
  // Emit event for other components (e.g., ViewerToolbar 2D mode)
  const floor = floors.find(f => f.id === floorId);
  const bounds = calculateFloorBounds(floorId);
  const eventDetail: FloorSelectionEventDetail = {
    floorId,
    floorName: floor?.name || null,
    bounds: bounds ? { minY: bounds.minY, maxY: bounds.maxY } : null,
  };
  window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, { detail: eventDetail }));
  
  if (onVisibleFloorsChange) {
    if (floor) {
      onVisibleFloorsChange(floor.databaseLevelFmGuids);
    }
  }
}, [applyFloorVisibility, floors, onVisibleFloorsChange, updateClipping, calculateFloorBounds]);
```

Detta fungerar redan. Det verkliga problemet är att Asset+ viewer visar IfcSpace-geometri som standard vid floor cutout. Vi behöver anropa `onShowSpacesChanged(false)` för att dölja dem.

### Del 4: Koppla spaces-synlighet till floor filtering

**Fil: `src/components/viewer/VisualizationToolbar.tsx`**

Modifiera `handleVisibleFloorsChange` för att återinitiera spaces-visibility baserat på `showSpaces` state:

```typescript
// Handle visible floors change from floor selector
const handleVisibleFloorsChange = useCallback((visibleFloorIds: string[]) => {
  console.log("Visible floors changed:", visibleFloorIds);
  onVisibleFloorsChange?.(visibleFloorIds);
  
  // Re-apply spaces visibility to ensure correct floor-filtered state
  // This ensures only the visible floors' spaces are shown if showSpaces is enabled
  try {
    const assetViewer = viewerRef.current?.assetViewer;
    if (assetViewer?.onShowSpacesChanged) {
      // First hide all spaces, then re-enable if showSpaces is on
      assetViewer.onShowSpacesChanged(false);
      if (showSpaces) {
        // Small delay to allow floor filtering to complete
        setTimeout(() => {
          assetViewer.onShowSpacesChanged(true);
        }, 100);
      }
    }
  } catch (e) {
    console.debug("Could not sync spaces visibility:", e);
  }
}, [onVisibleFloorsChange, viewerRef, showSpaces]);
```

---

## Sammanfattning av filändringar

| Fil | Ändring |
|-----|---------|
| `src/components/viewer/ToolbarSettings.tsx` | Ta bort dubblettverktyg: viewMode, annotations, bimModels, floors, addAsset. Öka VERSION till 5. |
| `src/components/viewer/AssetPlusViewer.tsx` | Explicit dölja spaces i `handleAllModelsLoaded` |
| `src/components/viewer/VisualizationToolbar.tsx` | Synkronisera spaces-synlighet vid floor-ändring |

---

## Förväntade resultat

1. **Rum dolda som standard**: Vid initial laddning och floor cutout kommer rum att vara dolda om inte "Visa rum" är aktiverat
2. **Korrekt floor filtering**: När man väljer Solo på ett våningsplan visas endast det våningsplanets rum (om aktiverat)
3. **Ren verktygslista**: "Anpassa verktygsfält" visar endast verktyg som faktiskt finns i navigations-toolbaren (botten), utan dubbletter av VisualizationToolbar-verktyg
