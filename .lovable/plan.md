
# Plan: Fixa klippning, visningsfel och inventerings-UX i 3D-viewern

## Sammanfattning av identifierade problem

### 1. Våningsplansklippning fungerar inte korrekt i 3D
**Problem:** När man väljer ett våningsplan i 3D syns objekt från andra våningsplan som sticker upp (t.ex. väggar).
**Orsak:** Klippning (SectionPlane) aktiveras inte automatiskt i 3D "Solo"-läge. Saxikonen (Scissors) som aktiverar klippningen har försvunnit från Visningsmenyn.

### 2. IfcCovering-objekt (gröna) syns felaktigt
**Problem:** Gröna objekt av typen "Covering" visas i 3D även om de borde klippas bort.
**Lösning:** Dölj IfcCovering-objekt automatiskt i 3D Solo-läge, alternativt löses det av korrekt klippning.

### 3. 2D-klipphöjdsslider fungerar inte
**Problem:** Slidern för klipphöjd i 2D-läge visas, men ingenting händer när man ändrar värdet.
**Orsak:** `CLIP_HEIGHT_CHANGED_EVENT` skickas men tas inte emot korrekt av ViewerToolbar, eller section plane uppdateras inte.

### 4. Inventeringssidans egenskapsfönster är för brett
**Problem:** Formuläret (ResizablePanel) har för stor standardbredd.
**Lösning:** Minska `defaultSize` från 80% till ~40% när ingen viewer-panel är öppen.

### 5. 360°-positionsknappen saknas
**Problem:** Knappen "Öppna 360+" visas inte i inventeringsformuläret.
**Orsak:** `buildingSettings?.ivion_site_id` är null/undefined, så hela 360+-sektionen renderas inte.

### 6. "Skapa tillgång i 3D" - dialog-UX
**Problem:** Dialogen har solid bakgrund, är inte draggbar, och detekterar inte automatiskt byggnad/våning/rum.
**Lösning:** 
- Gör AssetPropertiesDialog transparent och draggbar
- Detektera rum från kamerans position eller senaste pick
- Implementera två-stegs bekräftelse för positionspicking (peka → bekräfta)

### 7. Annotation visas inte direkt vid positionsval
**Problem:** När man pekar ut en position visas ingen visuell markör.
**Lösning:** Skapa en temporär annotation direkt vid klick.

---

## Tekniska ändringar

### Del 1: Fixa 3D våningsplansklippning med saxikon

**Fil: `src/components/viewer/FloorVisibilitySelector.tsx`**

1. Lägg till state och logik för `clippingEnabled` som redan finns men inte används korrekt
2. Se till att `updateClipping()` anropas med rätt parametrar i Solo-läge
3. Lägg till Sax-ikon toggle i headern som aktiverar/avaktiverar klippning

```typescript
// I handleShowOnlyFloor - aktivera klippning automatiskt
const handleShowOnlyFloor = useCallback((floorId: string) => {
  // ... existing code ...
  
  // Aktivera klippning automatiskt i Solo-läge
  if (enableClipping) {
    setClippingEnabled(true);
    applyCeilingClipping(floorId); // Klipp vid taknivå
  }
}, [...]);
```

**Fil: `src/components/viewer/VisualizationToolbar.tsx`**

Lägg till Sax-toggle i Våningsplan-sektionen:
```typescript
// Efter "Våningsplan"-raden, lägg till klippnings-toggle
<div className="flex items-center justify-between py-1.5">
  <div className="flex items-center gap-2">
    <Scissors className="h-3.5 w-3.5" />
    <span className="text-xs">Klipp vid tak</span>
  </div>
  <Switch checked={clippingEnabled} onCheckedChange={setClippingEnabled} />
</div>
```

### Del 2: Dölj IfcCovering automatiskt i Solo-läge

**Fil: `src/components/viewer/FloorVisibilitySelector.tsx`**

I `applyFloorVisibility()` - lägg till logik för att dölja Covering:
```typescript
// Efter att ha satt synlighet, dölj IfcCovering om solo-läge
const metaObjects = viewer.metaScene?.metaObjects || {};
Object.values(metaObjects).forEach((metaObj: any) => {
  if (metaObj.type?.toLowerCase() === 'ifccovering') {
    const entity = scene.objects?.[metaObj.id];
    if (entity) entity.visible = false;
  }
});
```

### Del 3: Fixa 2D-klipphöjdsslider

**Fil: `src/hooks/useSectionPlaneClipping.ts`**

Problemet är att `updateFloorCutHeight` inte triggar om-rendering korrekt. Fixa:
```typescript
const updateFloorCutHeight = useCallback((newHeight: number) => {
  floorCutHeightRef.current = newHeight;
  
  const viewer = getXeokitViewer();
  if (!viewer?.scene) return;
  
  // Förstör befintligt section plane och skapa nytt
  if (sectionPlaneRef.current) {
    sectionPlaneRef.current.destroy?.();
    sectionPlaneRef.current = null;
  }
  
  // Tillämpa ny klippning
  if (currentFloorIdRef.current) {
    applySectionPlane(currentFloorIdRef.current, 'floor');
  } else {
    const sceneAABB = viewer.scene?.getAABB?.();
    if (sceneAABB) {
      applyGlobalFloorPlanClipping(sceneAABB[1]);
    }
  }
}, [applySectionPlane, getXeokitViewer, applyGlobalFloorPlanClipping]);
```

### Del 4: Minska formulärbredd på Inventory-sidan

**Fil: `src/pages/Inventory.tsx`**

Ändra `defaultSize` för mittenkolumnen:
```typescript
// Från:
<ResizablePanel defaultSize={showViewerPanel ? 30 : 80} minSize={25} maxSize={showViewerPanel ? 40 : 85}>

// Till:
<ResizablePanel defaultSize={showViewerPanel ? 30 : 40} minSize={25} maxSize={showViewerPanel ? 45 : 50}>
```

### Del 5: Visa 360°-knappen även utan Ivion Site ID

**Fil: `src/components/inventory/InventoryForm.tsx`**

Knappen är redan där men villkoret döljer den. Visa alltid men med disabled-state:
```typescript
// Ändra rad 611 från:
{buildingSettings?.ivion_site_id && (

// Till:
<div className="border border-border rounded-lg p-3 space-y-3">
  {/* Visa alltid 360+ section */}
  {buildingSettings?.ivion_site_id ? (
    // Existerande kod...
  ) : (
    <div className="text-xs text-muted-foreground flex items-center gap-2">
      <Eye className="h-4 w-4" />
      <span>360+ kräver Ivion Site ID i byggnadsinställningar</span>
    </div>
  )}
</div>
```

### Del 6: Transparent, draggbar dialog för "Skapa tillgång i 3D"

**Fil: `src/components/viewer/AssetPropertiesDialog.tsx`**

1. Lägg till draggbar funktionalitet
2. Gör bakgrunden transparent
3. Detektera byggnad/våning/rum från viewerns aktuella kontext

```typescript
// Lägg till samma drag-logik som i VisualizationToolbar
const [position, setPosition] = useState({ x: 100, y: 100 });
const [isDragging, setIsDragging] = useState(false);

// CSS-klass:
"bg-card/70 backdrop-blur-lg"

// Detektera rum från senaste pick eller kamerans position
useEffect(() => {
  if (createMode && !parentSpaceFmGuid) {
    // Försök detektera rum från viewerRef
    const camera = viewerRef?.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer?.camera;
    // ... logik för att hitta närmaste rum
  }
}, [createMode]);
```

### Del 7: Visa annotation direkt vid positionsval

**Fil: `src/components/viewer/AssetPlusViewer.tsx`**

I `handlePick()` - skapa temporär annotation direkt:
```typescript
const handlePick = (pickResult: any) => {
  if (pickResult?.worldPos) {
    const [x, y, z] = pickResult.worldPos;
    
    // Skapa temporär visuell markör direkt
    const tempMarker = document.createElement('div');
    tempMarker.className = 'temp-pick-marker';
    tempMarker.innerHTML = '📍';
    tempMarker.style.cssText = `
      position: absolute;
      font-size: 24px;
      transform: translate(-50%, -100%);
      pointer-events: none;
      z-index: 1000;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
    `;
    
    // Projicera world-koordinater till screen
    const canvas = xeokitViewer.scene.canvas.canvas;
    const rect = canvas.getBoundingClientRect();
    const canvasPos = xeokitViewer.scene.camera.projectWorldPos([x, y, z]);
    
    tempMarker.style.left = `${rect.left + canvasPos[0]}px`;
    tempMarker.style.top = `${rect.top + canvasPos[1]}px`;
    document.body.appendChild(tempMarker);
    
    // Ta bort efter 3 sekunder eller vid nästa pick
    setTimeout(() => tempMarker.remove(), 3000);
    
    // ... befintlig kod ...
  }
};
```

### Del 8: Två-stegs bekräftelse för positionspicking

**Fil: `src/components/viewer/AssetPlusViewer.tsx`**

Lägg till en "Bekräfta position"-knapp istället för direkt dialog-öppning:
```typescript
// Ny state
const [pendingPickCoords, setPendingPickCoords] = useState<{x:number,y:number,z:number}|null>(null);

// I handlePick - spara koordinater men öppna inte dialog direkt
setPendingPickCoords(coords);

// Visa "Bekräfta/Välj om"-knappar overlay
{pendingPickCoords && (
  <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 bg-card/90 backdrop-blur-sm p-3 rounded-lg shadow-lg flex gap-2">
    <Button variant="outline" onClick={() => {
      setPendingPickCoords(null);
      setupPickModeListenerInternal();
    }}>
      Välj om
    </Button>
    <Button onClick={() => {
      setPickedCoordinates(pendingPickCoords);
      setAddAssetDialogOpen(true);
      setPendingPickCoords(null);
    }}>
      Bekräfta position
    </Button>
  </div>
)}
```

---

## Filändringar sammanfattning

| Fil | Ändringar |
|-----|-----------|
| `src/components/viewer/FloorVisibilitySelector.tsx` | Aktivera klippning automatiskt i Solo-läge, dölj IfcCovering |
| `src/components/viewer/VisualizationToolbar.tsx` | Lägg till Sax-toggle för klippning |
| `src/hooks/useSectionPlaneClipping.ts` | Fixa `updateFloorCutHeight` för att faktiskt uppdatera klippningen |
| `src/pages/Inventory.tsx` | Minska formulärets standardbredd |
| `src/components/inventory/InventoryForm.tsx` | Visa 360+-sektion alltid, med disabled-state om ej konfigurerat |
| `src/components/viewer/AssetPropertiesDialog.tsx` | Gör transparent och draggbar |
| `src/components/viewer/AssetPlusViewer.tsx` | Visa temp-markör, två-stegs bekräftelse, rum-detektering |

---

## Förväntade resultat

1. **Våningsplan klipps korrekt** - Väggar/objekt från andra våningar döljs i Solo-läge
2. **IfcCovering döljs** - Gröna objekt försvinner vid våningsfiltrering
3. **2D-slider fungerar** - Klipphöjden uppdateras i realtid
4. **Smalare formulär** - Egenskapsfönstret tar ~40% istället för 80%
5. **360°-knapp synlig** - Alltid synlig med förklarande text om ej konfigurerad
6. **Transparent draggbar dialog** - Flyter över 3D-vyn
7. **Direkt visuell feedback** - Markör visas vid klick
8. **Två-stegs bekräftelse** - Användaren kan välja om position
