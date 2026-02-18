
# Plan: Fixa 3D-laddning, Modellträd och Toolbar

## Problem 1 (KRITISK): 3D-spinner blockerar viewern

### Rotorsak
`xktSyncStatus` sätts till `'checking'` omedelbart när komponenten monteras (i `ensureModels` effecten). Loading-spinnern visas när `xktSyncStatus === 'checking'` AND `state.isInitialized === true`. Det innebär att spinnern **blockerar 3D-viewern** hela tiden från det att viewern initialiseras tills `ensureModels` är klar — vilket kan ta 3-5 sekunder för byggnader utan XKT-cache.

För byggnader utan XKT (Centralstationen, Åkerselva): `ensureBuildingModels` returnerar `{cached: false, syncing: false}` → sätter `'idle'` → spinnern borde försvinna. Men `ensureModels` startar med `'checking'` och tar tid → det finns ett fönster där viewern är klar men spinnern blockar.

### Fix
Ändra spinner-logiken så att `xktSyncStatus === 'checking'` ALDRIG blockerar viewern. Spinnern ska bara visas under faktisk synkronisering (`'syncing'`) och bara om modeller inte laddats (`modelLoadState !== 'loaded'`). Ta dessutom bort `'checking'`-statusen ur spinner-villkoret:

```tsx
// FÖRE (blockerar viewern):
{((state.isLoading && !state.isInitialized) || 
  (modelLoadState !== 'loaded' && (xktSyncStatus === 'syncing' || xktSyncStatus === 'checking') && state.isInitialized)) && ...}

// EFTER (blockerar inte):  
{((state.isLoading && !state.isInitialized) || 
  (modelLoadState !== 'loaded' && xktSyncStatus === 'syncing' && state.isInitialized)) && ...}
```

## Problem 2: Alla BIM-modeller laddas (inte bara A-modell)

### Rotorsak
`allowedModelIdsRef` är ett filter för CACHEN (interceptorn) men INTE för vilka modeller viewern laddar. Viewern bestäms av `additionalDefaultPredicate: () => true` (rad 3233) — detta returnerar alltid sant och laddar ALLA modeller.

Dessutom: `GetModels` API returnerar 404 för byggnader som Centralstationen/Åkerselva — varför `nameMap` är tom → `allowedModelIdsRef.current = null` → alla modeller laddas.

### Fix
`additionalDefaultPredicate` ska använda `allowedModelIdsRef` för att filtrera vilka modeller viewern faktiskt laddar:

```typescript
// Skicka med predicate som kontrollerar whitelist:
(modelId: string) => {
  // Om ingen whitelist → ladda alla
  if (!allowedModelIdsRef.current) return true;
  // Annars kontrollera om modell-ID finns i whitelist
  return allowedModelIdsRef.current.has(modelId) || 
         allowedModelIdsRef.current.has(modelId.toLowerCase());
},
```

Dessutom: API-anropet för modellnamn (`GetModels`) verkar returna 404 för vissa byggnader. Vi måste hantera detta mer robust — om API returnerar 404, sätt `allowedModelIdsRef.current = null` så alla modeller laddas (graceful fallback).

## Problem 3: BIM-modellnamn visas som "myModel undefined"

### Rotorsak
Skärmbild visar: "myModel undefined 0 3409.73817..." — detta är Asset+ viewer's interna representation när modellnamnet inte är satt. Modellerna laddas men namnges aldrig korrekt.

Problemet är att `nameMap` är tom (API returnerar 404 eller tomt svar för den aktuella byggnaden) → `allowedModelIdsRef` är null → alla modeller laddas med sina råa ID:n som namn.

`ModelVisibilitySelector` hämtar namn via `useModelNames` hooken som läser från `xkt_models.model_name`. Om `model_name` är ett GUID eller null → fallback till filnamn.

### Fix
- Säkerställ att `GetModels` API-felet loggas tydligt 
- Lägg till loggning när modellnamn saknas
- I `ModelVisibilitySelector`, om ett namn är ett UUID → visa "Modell 1", "Modell 2" etc. istället för UUID

## Problem 4: Modellträdet visar fel data (IFC-hierarki istället för Asset+ hierarki)

### Rotorsak
`ViewerTreePanel.buildTree()` bygger trädet från `xeokitViewer.metaScene.rootMetaObjects` — detta är IFC-geometrins interna namngivning (IfcBuildingStorey med GUID-namn från IFC-filen). Användaren vill ha:

1. **Startpunkt**: Asset+ byggnadsplaner från databasen (`assets` tabell, `category = 'Building Storey'`)
2. **Hierarki**: Våning → Rum (Space/IfcSpace) → Tillgångar/Element (liknande Navigator)
3. **Checkbox-beteende**: En markerad våning → Solo-läge för den våningen. Flera markerade → alla markerade blir Solo

### Fix (komplett omskrivning av ViewerTreePanel):

#### Struktur
```
📐 [CB] Våning 01 (från Asset+ DB)
  🚪 [CB] Rum A101
    📦 Element...
  🚪 [CB] Rum A102  
📐 [CB] Våning 02
  ...
```

#### Data-hämtning
Istället för att bygga trädet från XEOKit metaScene, hämta data från:
1. `AppContext.allData` — redan laddad, innehåller alla Storeys och Spaces för byggnadens `fmGuid`
2. Matcha Asset+ `fm_guid` mot XEOKit `metaScene.metaObjects` via `originalSystemId` för att få IFC-objekt-IDs för synkronisering

```typescript
// Hämta storeys från allData (Asset+ hierarki)
const storeys = allData.filter(a => 
  a.buildingFmGuid === buildingFmGuid && 
  (a.category === 'Building Storey' || a.category === 'IfcBuildingStorey')
).sort(/* sortera efter namn */)

// Hämta rum för varje storey
const rooms = allData.filter(a => 
  a.levelFmGuid === storey.fmGuid && 
  (a.category === 'Space' || a.category === 'IfcSpace')
)
```

#### Checkbox → Solo visibility
Vid kryss på en våning:
1. Samla alla XEOKit IDs för den våningens innehåll (via `metaScene` + `originalSystemId` matchning)
2. Göm alla andra våningars objekt
3. Visa enbart de markerade våningarnas objekt
4. Dispatcha `FLOOR_SELECTION_CHANGED_EVENT` för synkronisering med FloatingFloorSwitcher

## Problem 5: Toolbar saknar tidigare funktioner

### Nuvarande toolbar (8 knappar)
Orbit, FirstPerson, ZoomIn, ZoomOut, FitView, Select, Measure, Slicer, 2D/3D-toggle

### Vad som saknades (från tidigare implementation)
Baserat på projekthistoriken innehöll den gamla toolbaren:
- X-ray toggle
- Annotations toggle  
- Room visualization toggle
- NavCube toggle
- Settings/Hamburger

Dessa finns nu i `ViewerRightPanel` (höger panel via hamburger-knappen). Problemet är att hamburger-knappen är svår att hitta.

### Fix
Behåll nuvarande toolbar (8 knappar) men lägg till tillbaka:
- **X-ray** knapp i toolbar (idag finns `XrayToggle` som en separat komponent men den är gömd i RightPanel)
- **Rum-visualisering** snabbknapp i toolbar
- Säkerställ att hamburger-knappen (≡) för RightPanel är tydligare synlig

Vi kan återintroducera XrayToggle i toolbar eftersom det är en primär funktion:

```tsx
// Lägg till i toolbar
<XrayToggle viewerRef={viewerRef} compact />
```

## Konkret implementation — filändringar

### Fil 1: `src/components/viewer/AssetPlusViewer.tsx`
**Ändring 1**: Spinner-fix — ta bort `'checking'` från spinner-villkor (rad 3626)
```tsx
// Rad 3626 — ändra:
{((state.isLoading && !state.isInitialized) || 
  (modelLoadState !== 'loaded' && xktSyncStatus === 'syncing' && state.isInitialized)) && (
```

**Ändring 2**: `additionalDefaultPredicate` — använd allowedModelIdsRef (rad 3233)
```typescript
// Ersätt:
() => true,
// Med:
(modelId: string) => {
  if (!allowedModelIdsRef.current) return true;
  return allowedModelIdsRef.current.has(modelId) || 
         allowedModelIdsRef.current.has(modelId.toLowerCase());
},
```

**Ändring 3**: Sätt `allowedModelIdsRef.current = null` (ladda alla) om API-anrop misslyckas för byggnader utan modeller.

### Fil 2: `src/components/viewer/ViewerTreePanel.tsx`
**Komplett omskrivning av datamodell**:
- Ta emot `buildingFmGuid` och `allData` som props
- Hämta storeys/spaces från `allData` istället för XEOKit metaScene
- Matcha Asset+ fmGuid mot XEOKit's `originalSystemId` för synkronisering
- Implementera checkbox → solo-visibility med `FLOOR_SELECTION_CHANGED_EVENT`
- Behåll befintlig UI-layout (embedded/floating panel, search, drag/resize)

**Ny props-interface**:
```typescript
interface ViewerTreePanelProps {
  viewerRef: React.RefObject<any>;
  buildingFmGuid?: string;     // NY: för Asset+ data-hämtning  
  buildingData?: any[];        // NY: allData (storeys + spaces)
  isVisible: boolean;
  onClose: () => void;
  // ... befintliga props
}
```

### Fil 3: `src/components/viewer/ViewerToolbar.tsx`
Lägg till XRay-knapp:
```tsx
import { Eye } from 'lucide-react';

// Ny knapp i Group 3:
<ToolButton
  icon={<Eye className="h-4 w-4" />}
  label="X-Ray (genomsiktlig vy)"
  onClick={handleXrayToggle}
  active={isXrayActive}
  disabled={disabled}
/>
```

## Prioritetsordning
1. **AssetPlusViewer.tsx spinner-fix** — löser att viewern blockeras (alla byggnader)
2. **AssetPlusViewer.tsx additionalDefaultPredicate** — fixar att bara A-modell laddas
3. **ViewerTreePanel.tsx** — komplett omskrivning med Asset+ data
4. **ViewerToolbar.tsx** — lägg till XRay-knapp

## Tekniska detaljer: ViewerTreePanel omskrivning

### Matchning Asset+ fmGuid → XEOKit objekt-IDs

XEOKit's `metaScene.metaObjects` har `originalSystemId` som matchar Asset+ `fmGuid` (GUID):

```typescript
const getXeokitIdsForFmGuid = (fmGuid: string): string[] => {
  const xeokitViewer = getXeokitViewer();
  if (!xeokitViewer?.metaScene?.metaObjects) return [];
  
  const ids: string[] = [];
  Object.values(xeokitViewer.metaScene.metaObjects).forEach((obj: any) => {
    const sysId = (obj.originalSystemId || '').toLowerCase();
    if (sysId === fmGuid.toLowerCase()) {
      ids.push(obj.id);
      // Also add all children recursively
    }
  });
  return ids;
}
```

### Solo-visibility vid checkbox

```typescript
const handleStoreyCheck = (storeyFmGuids: string[], visible: boolean) => {
  const xeokitViewer = getXeokitViewer();
  const scene = xeokitViewer?.scene;
  if (!scene) return;

  if (visible && checkedStoreys.size > 0) {
    // Solo mode: hide all, show selected
    scene.setObjectsVisible(scene.objectIds, false);
    
    checkedStoreys.forEach(fmGuid => {
      const ids = getXeokitIdsForFmGuid(fmGuid);
      ids.forEach(id => {
        // Recursively show all children
        const obj = scene.objects[id];
        if (obj) obj.visible = true;
      });
    });
  }
  
  // Dispatch floor event
  window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, { 
    detail: { visibleFloorFmGuids: [...checkedStoreys] } 
  }));
};
```

## Desktop och mobil
Alla ändringar gäller både desktop och mobil. `ViewerTreePanel` används på desktop (floating panel + embedded via MobileViewerOverlay på mobil). `ViewerToolbar` visas på desktop; på mobil är toolsen i MobileViewerOverlay — XRay-knappen behöver också läggas till i MobileViewerOverlay's settings-panel.
