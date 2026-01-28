

# Plan: Byt "Registrera tillgång" till Inventeringsformulär med inline-positionsval

## Sammanfattning

Ändra funktionen "Registrera tillgång" i Visning-menyn så att den öppnar inventeringsformuläret (InventoryForm) istället för den nuvarande AssetPropertiesDialog. Formuläret ska visas som en draggbar dialog/Sheet på sidan av 3D-viewern medan den redan laddade 3D-vyn används för positionsval.

---

## Nuvarande flöde

```text
1. Användare klickar "Registrera tillgång" i Visning-menyn
2. handleAddAsset() kallas → onAddAsset() → handleTogglePickMode()
3. Pickläge aktiveras - användaren klickar i 3D
4. AssetPropertiesDialog öppnas med koordinater
5. Förenklad form med begränsade fält
```

## Nytt flöde

```text
1. Användare klickar "Registrera tillgång" i Visning-menyn
2. InventoryFormSheet öppnas direkt (Sheet med InventoryForm)
3. Byggnaden förfylls baserat på aktuell byggnad i viewern
4. Användaren kan klicka "Välj 3D-position" i formuläret
5. Pickläge aktiveras i samma viewer som redan är öppen
6. Koordinater skickas till formuläret via callback
7. Användaren fyller i resten av formuläret och sparar
```

---

## Tekniska ändringar

### 1. Ny komponent: `InventoryFormSheet.tsx`

Skapa en ny Sheet-komponent som:
- Visar InventoryForm i en Sheet/drawer
- Stödjer positionsval via callback
- Förfyller byggnads-fmGuid från viewer-kontexten
- Är draggbar på desktop

```typescript
interface InventoryFormSheetProps {
  isOpen: boolean;
  onClose: () => void;
  buildingFmGuid: string;
  levelFmGuid?: string | null;
  roomFmGuid?: string | null;
  pendingPosition?: { x: number; y: number; z: number } | null;
  onPickPositionRequest?: () => void;  // Triggers pick mode in viewer
  isPickingPosition?: boolean;
}

// Sheet-variant som positioneras till höger/botten beroende på skärmstorlek
// Innehåller InventoryForm med anpassade callbacks
```

### 2. Ändra AssetPlusViewer.tsx

**Ta bort:** Logik som öppnar `AssetPropertiesDialog` i createMode

**Lägg till:**
- State för `inventorySheetOpen`
- Callback `handleOpenInventoryForm` som öppnar sheeten
- Skicka `buildingFmGuid` och `levelFmGuid` som prefill
- När användaren klickar "Välj 3D-position" i formuläret, aktivera pickläge
- När position väljs, skicka tillbaka till sheeten via `pendingPosition`

```typescript
// Ny state
const [inventorySheetOpen, setInventorySheetOpen] = useState(false);
const [inventoryPendingPosition, setInventoryPendingPosition] = useState<{x:number,y:number,z:number}|null>(null);

// Modifiera handleTogglePickMode till att stödja inventory flow
const handleInventoryPickRequest = useCallback(() => {
  // Aktivera pick mode, men skicka resultat till inventoryPendingPosition
  // istället för att öppna AssetPropertiesDialog
  setupPickModeListenerForInventory();
  setIsPickMode(true);
}, []);
```

### 3. Ändra VisualizationToolbar.tsx

**Ersätt:** `onAddAsset` callback

**Med:** `onOpenInventoryForm` callback som öppnar inventeringsformuläret

Eller behåll samma callback-namn men ändra beteendet i AssetPlusViewer.

### 4. Uppdatera InventoryForm.tsx

InventoryForm stödjer redan:
- `prefill` prop för att förfylla byggnad/våning/rum
- `pendingPosition` prop för att ta emot koordinater
- `onOpen3d` callback för att begära 3D-picker

**Anpassa:** När `onOpen3d` kallas och vi redan är i 3D-viewern, skicka `onPickPositionRequest()` istället för att öppna en ny dialog.

---

## Komponentstruktur efter ändring

```text
AssetPlusViewer
├── ViewerToolbar (bottom)
├── VisualizationToolbar (top-right)
│   └── "Registrera tillgång" → setInventorySheetOpen(true)
├── [Viewer Canvas]
├── InventoryFormSheet (right side sheet) ← NY
│   └── InventoryForm
│       ├── Byggnadsväljare (förfylld)
│       ├── Våningsväljare
│       ├── Rumsväljare
│       ├── "Välj 3D-position" → onPickPositionRequest()
│       └── Symbolväljare, Bild, etc.
└── (AssetPropertiesDialog behålls för view/edit mode, tas bort för createMode)
```

---

## Detaljerade kodändringar

### Fil 1: `src/components/inventory/InventoryFormSheet.tsx` (NY)

```typescript
import React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import InventoryForm from './InventoryForm';
import type { InventoryItem } from '@/pages/Inventory';

interface InventoryFormSheetProps {
  isOpen: boolean;
  onClose: () => void;
  buildingFmGuid: string;
  levelFmGuid?: string | null;
  roomFmGuid?: string | null;
  pendingPosition?: { x: number; y: number; z: number } | null;
  onPickPositionRequest?: () => void;
  isPickingPosition?: boolean;
  onPendingPositionConsumed?: () => void;
}

const InventoryFormSheet: React.FC<InventoryFormSheetProps> = ({
  isOpen,
  onClose,
  buildingFmGuid,
  levelFmGuid,
  roomFmGuid,
  pendingPosition,
  onPickPositionRequest,
  isPickingPosition,
  onPendingPositionConsumed,
}) => {
  const handleSaved = (item: InventoryItem) => {
    onClose();
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Registrera tillgång</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          <InventoryForm
            onSaved={handleSaved}
            onCancel={onClose}
            prefill={{
              buildingFmGuid,
              levelFmGuid: levelFmGuid || undefined,
              roomFmGuid: roomFmGuid || undefined,
            }}
            // Use the inline pick mode, don't open separate 3D picker dialog
            onOpen3d={onPickPositionRequest ? () => onPickPositionRequest() : undefined}
            pendingPosition={pendingPosition}
            onPendingPositionConsumed={onPendingPositionConsumed}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default InventoryFormSheet;
```

### Fil 2: `src/components/viewer/AssetPlusViewer.tsx`

**Lägg till state:**
```typescript
const [inventorySheetOpen, setInventorySheetOpen] = useState(false);
const [inventoryPendingPosition, setInventoryPendingPosition] = useState<{x:number,y:number,z:number}|null>(null);
const inventoryPickModeRef = useRef(false); // Track if pick is for inventory
```

**Modifiera setupPickModeListenerInternal:**
```typescript
// I handlePick-funktionen:
if (inventoryPickModeRef.current) {
  // Send to inventory form
  setInventoryPendingPosition(coords);
  inventoryPickModeRef.current = false;
  setIsPickMode(false);
} else if (onCoordinatePicked) {
  // External callback
  onCoordinatePicked(coords, parentNode);
  setIsPickMode(false);
} else {
  // Old dialog flow - kan tas bort eller behållas som fallback
}
```

**Lägg till callback för inventory:**
```typescript
const handleInventoryPickRequest = useCallback(() => {
  inventoryPickModeRef.current = true;
  const success = setupPickModeListenerInternal();
  if (success) {
    setIsPickMode(true);
    toast.info('Klicka på en yta i 3D-vyn för att välja position');
  }
}, [setupPickModeListenerInternal]);

const handleOpenInventorySheet = useCallback(() => {
  setInventorySheetOpen(true);
}, []);
```

**Uppdatera VisualizationToolbar prop:**
```typescript
<VisualizationToolbar
  ...
  onAddAsset={handleOpenInventorySheet}  // Ändrad från handleTogglePickMode
  ...
/>
```

**Lägg till InventoryFormSheet i render:**
```typescript
<InventoryFormSheet
  isOpen={inventorySheetOpen}
  onClose={() => {
    setInventorySheetOpen(false);
    setInventoryPendingPosition(null);
  }}
  buildingFmGuid={buildingFmGuid || ''}
  levelFmGuid={assetData?.levelFmGuid}
  roomFmGuid={assetData?.inRoomFmGuid || assetData?.fmGuid}
  pendingPosition={inventoryPendingPosition}
  onPickPositionRequest={handleInventoryPickRequest}
  isPickingPosition={isPickMode && inventoryPickModeRef.current}
  onPendingPositionConsumed={() => setInventoryPendingPosition(null)}
/>
```

---

## Sammanfattning av filändringar

| Fil | Ändring |
|-----|---------|
| `src/components/inventory/InventoryFormSheet.tsx` | NY - Sheet-wrapper för InventoryForm |
| `src/components/viewer/AssetPlusViewer.tsx` | Lägg till inventory sheet state, modifiera pick-logik, byt onAddAsset till att öppna sheet |

---

## Förväntade resultat

1. **"Registrera tillgång"** öppnar det fullständiga inventeringsformuläret
2. **Sheet på sidan** - formuläret visas till höger om 3D-vyn
3. **Inline positionsval** - "Välj 3D-position" aktiverar pickläge i befintlig viewer
4. **Alla fält** - namn, kategori, symbol, byggnad, våning, rum, bild, beskrivning
5. **Förfylld byggnad** - baserat på aktuell viewer-kontext

