
# Plan: Fixa formulärbredd och förbättra 3D-positionsval

## Problem identifierade

1. **Formuläret har blivit för brett på desktop** - defaultSize är för stor (75% utan Ivion, 35% med Ivion)
2. **3D-positionen fångas under navigering** - Varje klick (även navigeringsklick) registreras som position
3. **Dialogen stängs direkt efter klick** - Användaren får ingen chans att verifiera positionen
4. **Ingen visuell markör** - Ingen annotation/symbol visas där man valt position
5. **3D-viewern behöver ligga kvar längre** - Samma mönster som Ivion (side-by-side)

---

## Lösning

### Del 1: Justera layoutbredderna

Ändra panelstorlekar i `Inventory.tsx`:

| Panel | Nuvarande | Nytt |
|-------|-----------|------|
| Lista (vänster) | defaultSize=25, minSize=15 | defaultSize=20, minSize=15, maxSize=30 |
| Formulär (mitten) | defaultSize=75/35, minSize=30 | defaultSize=30, minSize=25, maxSize=40 |
| 3D/360 (höger) | defaultSize=40, minSize=25 | Fyller resten (ca 50%) |

Formuläret får en smalare, fast bredd medan 3D-viewern fyller ut resten.

### Del 2: Ersätt dialog med side-panel för 3D

Istället för att öppna 3D i en modal dialog som stänger direkt efter klick:

1. **Öppna 3D-viewern som en resizable panel** (precis som Ivion)
2. **Använd "Bekräfta position" knapp** - Klick i 3D väljer position, men stänger inte
3. **Visa temporär markör** - Visuell feedback för vald position
4. **Behåll viewern öppen** tills användaren aktivt stänger eller bekräftar

### Del 3: Tvåstegsflöde för 3D-positionsval

1. **Navigera fritt** - Användaren navigerar i 3D utan att registrera position
2. **Aktivera "Välj position"** - Klicka på en knapp för att börja välja
3. **Klicka för att markera** - Position visas med markör
4. **Bekräfta eller ändra** - Möjlighet att klicka igen för att ändra
5. **Stäng viewern** - Position sparas till formuläret

---

## Detaljerade ändringar

### Inventory.tsx - Layout och 3D-panel

```typescript
// Ny state för 3D-position picker (inline)
const [viewer3dOpen, setViewer3dOpen] = useState(false);
const [viewer3dBuildingFmGuid, setViewer3dBuildingFmGuid] = useState<string | null>(null);
const [viewer3dRoomFmGuid, setViewer3dRoomFmGuid] = useState<string | null>(null);

// Handler från InventoryForm för att öppna 3D inline
const handleOpen3d = (buildingFmGuid: string, roomFmGuid?: string) => {
  setViewer3dBuildingFmGuid(buildingFmGuid);
  setViewer3dRoomFmGuid(roomFmGuid || null);
  setViewer3dOpen(true);
  // Stäng Ivion om den är öppen
  setIvion360Url(null);
};

// Desktop layout - justerade storlekar
<ResizablePanelGroup direction="horizontal" className="h-full">
  {/* Lista - smalare */}
  <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
    <InventoryList ... />
  </ResizablePanel>
  
  <ResizableHandle withHandle />
  
  {/* Formulär - fast bredd */}
  <ResizablePanel defaultSize={30} minSize={25} maxSize={40}>
    <InventoryForm
      onOpen3d={handleOpen3d}
      onOpen360={handleOpen360}
      onPositionPicked={handlePositionPicked}
      ...
    />
  </ResizablePanel>
  
  {/* 3D eller 360 - fyller resten */}
  {(viewer3dOpen || ivion360Url) && (
    <>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={50} minSize={30}>
        {viewer3dOpen ? (
          <Inline3dViewer
            buildingFmGuid={viewer3dBuildingFmGuid}
            roomFmGuid={viewer3dRoomFmGuid}
            onPositionConfirmed={handlePositionConfirmed}
            onClose={() => setViewer3dOpen(false)}
          />
        ) : (
          <Ivion360View url={ivion360Url} onClose={handleClose360} />
        )}
      </ResizablePanel>
    </>
  )}
</ResizablePanelGroup>
```

### Ny komponent: Inline3dPositionPicker.tsx

Skapar en wrapper-komponent för AssetPlusViewer med bekräfta-flöde:

```typescript
interface Inline3dPositionPickerProps {
  buildingFmGuid: string;
  roomFmGuid?: string;
  onPositionConfirmed: (coords: { x: number; y: number; z: number }) => void;
  onClose: () => void;
}

const Inline3dPositionPicker: React.FC<...> = ({
  buildingFmGuid,
  roomFmGuid,
  onPositionConfirmed,
  onClose,
}) => {
  const [pendingCoords, setPendingCoords] = useState<{x,y,z} | null>(null);
  const [pickModeActive, setPickModeActive] = useState(false);

  const handleCoordinatePicked = (coords) => {
    // Spara koordinater men stäng INTE viewern
    setPendingCoords(coords);
    toast.success(`Position markerad: (${coords.x.toFixed(2)}, ${coords.y.toFixed(2)}, ${coords.z.toFixed(2)})`);
  };

  const handleConfirm = () => {
    if (pendingCoords) {
      onPositionConfirmed(pendingCoords);
      onClose();
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 border-b bg-background/95">
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4" />
          <span className="text-sm font-medium">Välj 3D-position</span>
        </div>
        <div className="flex items-center gap-2">
          {!pickModeActive && (
            <Button size="sm" onClick={() => setPickModeActive(true)}>
              Börja välja position
            </Button>
          )}
          {pendingCoords && (
            <Button size="sm" onClick={handleConfirm}>
              Bekräfta position
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Instructions */}
      {pickModeActive && !pendingCoords && (
        <div className="bg-primary/10 px-3 py-2 text-sm">
          Klicka på en yta för att markera position
        </div>
      )}
      {pendingCoords && (
        <div className="bg-green-500/10 px-3 py-2 text-sm flex items-center justify-between">
          <span>Position: X:{pendingCoords.x.toFixed(2)} Y:{pendingCoords.y.toFixed(2)} Z:{pendingCoords.z.toFixed(2)}</span>
          <Button size="sm" variant="ghost" onClick={() => setPendingCoords(null)}>
            Välj ny position
          </Button>
        </div>
      )}

      {/* 3D Viewer */}
      <div className="flex-1 min-h-0">
        <AssetPlusViewer
          fmGuid={roomFmGuid || buildingFmGuid}
          pickModeEnabled={pickModeActive && !pendingCoords}
          onCoordinatePicked={handleCoordinatePicked}
          onClose={onClose}
        />
      </div>
    </div>
  );
};
```

### InventoryForm.tsx - Uppdaterad props

```typescript
interface InventoryFormProps {
  // ... befintliga
  onOpen3d?: (buildingFmGuid: string, roomFmGuid?: string) => void;
  onPositionPicked?: (coords: { x: number; y: number; z: number }) => void;
}

// Ersätt dialog-öppning med inline callback
const handleOpen3dPosition = () => {
  if (onOpen3d) {
    onOpen3d(buildingFmGuid, roomFmGuid);
  } else {
    // Fallback till dialog för mobil
    setPositionDialogOpen(true);
  }
};
```

### Ta bort PositionPickerDialog på desktop

Dialog används endast som fallback på mobil. Desktop använder inline-panel.

---

## Visuell översikt (Desktop)

```text
+---------------+------------------+--------------------------------+
|    Lista      |    Formulär      |           3D Viewer            |
|   (20%)       |     (30%)        |            (50%)               |
|               |                  |                                |
| > Asset 1     |  Namn: [___]     |   +-- Toolbar --+              |
| > Asset 2     |  Kategori: [v]   |   | [Börja välja] [Bekräfta X] |
|               |                  |   +--------------+              |
|               |  Position:       |   | Position: X:... Y:... Z:...|
|               |  [3D] [360+]     |   +--------------+              |
|               |                  |                                |
|               |  [Spara]         |   [ 3D-modell visas här ]      |
|               |                  |                                |
+---------------+------------------+--------------------------------+
```

---

## Filändringar

| Fil | Ändring |
|-----|---------|
| `src/pages/Inventory.tsx` | Justera panelstorlekar, lägg till 3D-panel state och handlers |
| `src/components/inventory/Inline3dPositionPicker.tsx` | NY - Wrapper för AssetPlusViewer med bekräfta-flöde |
| `src/components/inventory/InventoryForm.tsx` | Lägg till `onOpen3d` prop, använd inline istället för dialog |
| `src/components/inventory/PositionPickerDialog.tsx` | Behåll som fallback för mobil |

---

## Fördelar

1. **Konsistent layout** - 3D och 360 hanteras likadant (inline panel)
2. **Användaren styr flödet** - Navigera först, sedan aktivt välja position
3. **Visuell feedback** - Koordinater visas i toolbaren
4. **Möjlighet att ändra** - Klicka igen för ny position innan bekräfta
5. **Formuläret behåller smal bredd** - 3D-viewern får det utrymme den behöver

