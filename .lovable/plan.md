
# Plan: Rumsvisualisering - Flytande Panel, Auto-aktivering, Prestandaförbättring och Verktygsval

## Sammanfattning

Det finns fyra huvudproblem att lösa:

1. **RoomVisualizationPanel bör vara flytande** - Liksom VisualizationToolbar ska panelen kunna flyttas
2. **"Visa Rum" ska aktiveras automatiskt** - När RoomVisualizationPanel öppnas ska "Visa Rum" slås på
3. **Prestandan är för långsam** - All färgläggning sker på 700+ rum i hela byggnaden
4. **Verktygsval i navigeringstoolbaren** - Aktiv verktyg ska markeras tydligt och andra avmarkeras

---

## Del 1: Flytande Rumsvisualiseringspanel

**Fil:** `src/components/viewer/RoomVisualizationPanel.tsx`

Panelen är idag fixerad till `absolute top-4 right-4`. Vi lägger till:

- Draggable-logik med `mousedown`, `mousemove`, `mouseup` eventhantering
- Positionsstate (`position.x`, `position.y`)
- Ett draghandtag i headern (GripVertical-ikon)
- Fast positionering (`fixed` istället för `absolute`)

```text
Före:
+--------------------+
|  Rumsvisualisering |  (fast position)
+--------------------+

Efter:
+--[=]---------------+
|  Rumsvisualisering |  (kan dras fritt)
+--------------------+
```

---

## Del 2: Auto-aktivera "Visa Rum" när panelen öppnas

**Filer:**
- `src/components/viewer/RoomVisualizationPanel.tsx`
- `src/components/viewer/VisualizationToolbar.tsx`
- `src/components/viewer/AssetPlusViewer.tsx`

När `showVisualizationPanel` sätts till `true`:

1. `VisualizationToolbar` eller `AssetPlusViewer` anropar `viewerRef.current?.assetViewer?.onShowSpacesChanged(true)`
2. `RoomVisualizationPanel` får en ny prop `onShowSpaces` som anropas vid mount

---

## Del 3: Prestandaförbättring med Våningsfilter

**Problemet:** Systemet hämtar alla 700+ rum för byggnaden och färglägger dem alla. Detta tar lång tid.

**Lösningen:** Lägg till ett våningsfilter i RoomVisualizationPanel:

1. **Ny dropdown: "Välj våning"** - Listar alla våningar (IfcBuildingStorey) från FloorCarousel-logiken
2. **Filtrering mot databasen:** Använd `level_fm_guid` för att endast hämta rum på vald våning
3. **Standardvärde:** "Alla våningar" eller auto-välj nuvarande våning från FloorCarousel

**Databasquery-ändring:**

```sql
-- Nuvarande (alla rum):
SELECT fm_guid, name, attributes 
FROM assets 
WHERE category = 'Space' AND building_fm_guid = ?

-- Med våningsfilter (mycket snabbare):
SELECT fm_guid, name, attributes 
FROM assets 
WHERE category = 'Space' 
  AND building_fm_guid = ? 
  AND level_fm_guid = ?
```

**UI-förändring:**

```text
+-----------------------------+
| Rumsvisualisering           |
+-----------------------------+
| Våningsplan:  [Plan 2    v] |  <- NY dropdown
| Visualisering: [Temperatur] |
| Simulerad data: [  ] (av)   |
| [Färgskala...]              |
| 45 rum hittade | 42 färgade |  <- Minskat antal
+-----------------------------+
```

**Filstruktur:**

- `RoomVisualizationPanel.tsx` - Lägg till floor selector och prop för selectedFloorId
- Använd `level_fm_guid` från assets-tabellen för filtrering

---

## Del 4: Tydligare verktygsval i Navigeringstoolbaren

**Fil:** `src/components/viewer/ViewerToolbar.tsx`

**Problem:** När man byter verktyg är det inte alltid tydligt vilket som är aktivt.

**Lösningar:**

1. **Mutual exclusivity för verktygsgrupper:**
   - Navigation: orbit, firstPerson (endast en aktiv)
   - Verktyg: select, measure, slicer (endast ett aktivt)
   
2. **Visuell feedback:**
   - Aktivt verktyg får `ring-2 ring-primary bg-primary/20` styling
   - Inaktiva verktyg återställs till standardutseende

3. **Uppdatera handleToolChange:**
   - Vid byte av navigationsläge: avaktivera aktivt verktyg om det krockar
   - Vid byte av verktyg: anropa `assetView.useTool(null)` först, sedan `useTool(newTool)`

---

## Tekniska Detaljer

### RoomVisualizationPanel.tsx - Ändringar

```typescript
// Nya states för draggable
const [position, setPosition] = useState({ x: 0, y: 0 });
const [isDragging, setIsDragging] = useState(false);

// Nya props
interface RoomVisualizationPanelProps {
  viewerRef: ...;
  buildingFmGuid: string;
  onClose: () => void;
  onShowSpaces?: (show: boolean) => void;  // NY
  selectedFloorFmGuid?: string | null;      // NY - för filtrering
  availableFloors?: FloorInfo[];            // NY - våningslista
  className?: string;
}

// Flytta från 'absolute' till 'fixed' med dynamisk position
// Lägg till GripVertical i header för drag-handtag
```

### AssetPlusViewer.tsx - Ändringar

```typescript
// När showVisualizationPanel sätts true, aktivera spaces
const handleToggleVisualization = (visible: boolean) => {
  setShowVisualizationPanel(visible);
  if (visible) {
    // Auto-aktivera "Visa rum"
    viewerInstanceRef.current?.assetViewer?.onShowSpacesChanged?.(true);
  }
};

// Skicka selectedFloorId till RoomVisualizationPanel
<RoomVisualizationPanel
  ...
  selectedFloorFmGuid={selectedFloorId}
  onFloorChange={(floorFmGuid) => setSelectedFloorId(floorFmGuid)}
/>
```

### ViewerToolbar.tsx - Ändringar

```typescript
// Förbättrad handleToolChange med explicit deaktivering
const handleToolChange = useCallback((tool: ViewerTool) => {
  const assetView = getAssetView();
  if (!assetView) return;
  
  // Deaktivera alla verktyg först
  assetView.useTool(null);
  
  // Aktivera nytt verktyg
  if (tool !== activeTool) {
    assetView.useTool(tool);
    setActiveTool(tool);
  } else {
    // Toggle off if clicking same tool
    setActiveTool('select'); // Default till select
    assetView.useTool('select');
  }
}, [...]);

// Förbättrad styling för aktiv knapp
className={cn(
  "h-8 w-8",
  active && "ring-2 ring-primary bg-primary/10 text-primary"
)}
```

---

## Prioritetsordning

1. **Flytande panel** - Enkel förändring, stor UX-förbättring
2. **Auto-aktivera Visa Rum** - Liten förändring
3. **Våningsfilter för prestanda** - Störst påverkan på prestanda
4. **Verktygsval-förbättring** - Finslipning av UX

---

## Beräknad Påverkan

| Förändring | Filer | Komplexitet |
|------------|-------|-------------|
| Flytande panel | 1 | Låg |
| Auto-visa rum | 2-3 | Låg |
| Våningsfilter | 1-2 | Medel |
| Verktygsval | 1 | Låg |
