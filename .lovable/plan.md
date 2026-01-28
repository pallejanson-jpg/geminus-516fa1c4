
# Plan: Utöka IvionCreate med Plan/Rum-väljare & 3D Position Picker

## Sammanfattning

Utöka `/ivion-create` sidan med:
1. **Våningsplan- och Rum-väljare** - Lägg till dropdowns för Plan och Rum (samma som i InventoryForm)
2. **3D Position Picker** - Lägg till knapp för att välja position i 3D-viewern
3. **360+ Deep-linking** - Lägg till funktionalitet för att öppna Ivion med rätt rum/position

---

## Nuvarande tillstånd

### IvionCreate.tsx
- Har Building-väljare (hämtar från Supabase `assets` table)
- Saknar Floor/Room-väljare
- Saknar 3D position picker

### InventoryForm.tsx
- Använder `BuildingSelector`, `FloorSelector`, `RoomSelector` från `selectors/`
- Dessa komponenter kräver `AppContext.navigatorTreeData` för att fungera

### Problem
`IvionCreate` är en standalone-sida (kan köras utanför huvudappen i iframe) och har därför inte tillgång till `AppContext.navigatorTreeData`. Vi behöver antingen:
1. Hämta floor/room data direkt från Supabase
2. Eller skapa standalone versioner av selectors

---

## Implementation

### Del 1: Lägg till Floor/Room-väljare i IvionCreate

Skapa egna selectors som hämtar data från Supabase direkt istället för AppContext:

```typescript
// Nya state-variabler
const [floors, setFloors] = useState<{fm_guid: string; common_name: string; name: string}[]>([]);
const [rooms, setRooms] = useState<{fm_guid: string; common_name: string; name: string}[]>([]);
const [levelFmGuid, setLevelFmGuid] = useState('');
const [roomFmGuid, setRoomFmGuid] = useState('');

// Hämta våningar när byggnad väljs
useEffect(() => {
  if (!buildingFmGuid) return;
  supabase
    .from('assets')
    .select('fm_guid, common_name, name')
    .eq('building_fm_guid', buildingFmGuid)
    .eq('category', 'Building Storey')
    .order('common_name')
    .then(res => setFloors(res.data || []));
}, [buildingFmGuid]);

// Hämta rum när våning väljs
useEffect(() => {
  if (!levelFmGuid) return;
  supabase
    .from('assets')
    .select('fm_guid, common_name, name')
    .eq('level_fm_guid', levelFmGuid)
    .eq('category', 'Space')
    .order('common_name')
    .then(res => setRooms(res.data || []));
}, [levelFmGuid]);
```

### Del 2: Lägg till 3D Position Picker

Skapa en modal/dialog som visar 3D-viewern i pick-mode:

**Ny komponent: `PositionPickerDialog.tsx`**

```text
src/components/inventory/PositionPickerDialog.tsx

Props:
├── open: boolean
├── onOpenChange: (open: boolean) => void
├── buildingFmGuid: string
├── roomFmGuid?: string
├── initialCoordinates?: {x, y, z}
└── onPositionPicked: (coords: {x, y, z}) => void
```

**Funktionalitet:**
1. Öppnar Dialog med AssetPlusViewer i pick-mode
2. Om `roomFmGuid` finns - navigerar till det rummet
3. Användaren klickar på en yta → koordinater returneras
4. Dialog stängs och koordinater sparas

### Del 3: Uppdatera IvionCreate med 3D picker

Lägg till:
- "Välj position i 3D" knapp (synlig endast när byggnad är vald)
- PositionPickerDialog integration
- Koordinatvisning med möjlighet att rensa/ändra

```tsx
// I IvionCreate.tsx
const [positionDialogOpen, setPositionDialogOpen] = useState(false);
const [coordinates, setCoordinates] = useState<{x: number; y: number; z: number} | null>(
  x !== 0 || y !== 0 || z !== 0 ? { x, y, z } : null
);

// Knapp för att öppna 3D picker
<div className="space-y-2">
  <Label>Position</Label>
  {coordinates ? (
    <div className="bg-muted/50 rounded-lg p-3 flex items-center justify-between">
      <div className="font-mono text-sm">
        X: {coordinates.x.toFixed(2)} Y: {coordinates.y.toFixed(2)} Z: {coordinates.z.toFixed(2)}
      </div>
      <Button variant="ghost" size="sm" onClick={() => setCoordinates(null)}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  ) : (
    <Button
      variant="outline"
      onClick={() => setPositionDialogOpen(true)}
      disabled={!buildingFmGuid}
      className="w-full"
    >
      <Crosshair className="h-4 w-4 mr-2" />
      Välj position i 3D
    </Button>
  )}
</div>
```

### Del 4: 360+ Deep-linking funktionalitet

Lägg till knapp för att öppna Ivion med rätt rum/POI:

```tsx
// Om asset redan har ivion_poi_id
const handleOpen360 = () => {
  const ivionUrl = localStorage.getItem('ivionApiUrl') || 
                   buildingSettings?.ivion_url;
  
  if (ivionUrl && siteId) {
    // Navigera till specifik POI om vi har ett
    const url = poiId 
      ? `${ivionUrl}/site/${siteId}/poi/${poiId}`
      : `${ivionUrl}/site/${siteId}`;
    window.open(url, '_blank');
  }
};
```

---

## Fil-ändringar

| Fil | Ändring |
|-----|---------|
| `src/pages/IvionCreate.tsx` | Lägg till Floor/Room dropdowns, 3D position picker knapp, koordinathantering, spara level_fm_guid och in_room_fm_guid |
| `src/components/inventory/PositionPickerDialog.tsx` | NY: Modal med 3D-viewer i pick-mode |
| `src/components/portfolio/AssetsView.tsx` | Lägg till 360+ knapp per asset (för deep-linking) |

---

## Detaljerade ändringar i IvionCreate.tsx

### Nya imports
```tsx
import { Crosshair, View } from 'lucide-react';
import PositionPickerDialog from '@/components/inventory/PositionPickerDialog';
```

### Nya state-variabler
```tsx
// Floor and room selection
const [floors, setFloors] = useState<Array<{fm_guid: string; common_name: string | null; name: string | null}>>([]);
const [rooms, setRooms] = useState<Array<{fm_guid: string; common_name: string | null; name: string | null}>>([]);
const [levelFmGuid, setLevelFmGuid] = useState('');
const [roomFmGuid, setRoomFmGuid] = useState('');

// 3D position picker
const [positionDialogOpen, setPositionDialogOpen] = useState(false);
const [coordinates, setCoordinates] = useState<{x: number; y: number; z: number} | null>(
  (x !== 0 || y !== 0 || z !== 0) ? { x, y, z } : null
);
```

### Nya useEffects för datahämtning
```tsx
// Fetch floors when building changes
useEffect(() => {
  if (!buildingFmGuid) {
    setFloors([]);
    setLevelFmGuid('');
    return;
  }
  supabase
    .from('assets')
    .select('fm_guid, common_name, name')
    .eq('building_fm_guid', buildingFmGuid)
    .eq('category', 'Building Storey')
    .order('common_name')
    .then(({ data }) => setFloors(data || []));
}, [buildingFmGuid]);

// Fetch rooms when floor changes
useEffect(() => {
  if (!levelFmGuid) {
    setRooms([]);
    setRoomFmGuid('');
    return;
  }
  supabase
    .from('assets')
    .select('fm_guid, common_name, name')
    .eq('level_fm_guid', levelFmGuid)
    .eq('category', 'Space')
    .order('common_name')
    .then(({ data }) => setRooms(data || []));
}, [levelFmGuid]);
```

### Uppdatera handleSubmit
```tsx
const newAsset = {
  // ...existing fields...
  level_fm_guid: levelFmGuid || null,
  in_room_fm_guid: roomFmGuid || null,
  coordinate_x: coordinates?.x ?? null,
  coordinate_y: coordinates?.y ?? null,
  coordinate_z: coordinates?.z ?? null,
  // ...
};
```

### Nya UI-komponenter i formuläret

**Floor Selector:**
```tsx
{buildingFmGuid && floors.length > 0 && (
  <div className="space-y-2">
    <Label>Våningsplan</Label>
    <Select value={levelFmGuid} onValueChange={(v) => {
      setLevelFmGuid(v);
      setRoomFmGuid('');
    }}>
      <SelectTrigger className="h-12">
        <SelectValue placeholder="Välj våning..." />
      </SelectTrigger>
      <SelectContent className="bg-popover z-50">
        {floors.map((f) => (
          <SelectItem key={f.fm_guid} value={f.fm_guid}>
            {f.common_name || f.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
)}
```

**Room Selector:**
```tsx
{levelFmGuid && rooms.length > 0 && (
  <div className="space-y-2">
    <Label>Rum</Label>
    <Select value={roomFmGuid} onValueChange={setRoomFmGuid}>
      <SelectTrigger className="h-12">
        <SelectValue placeholder="Välj rum..." />
      </SelectTrigger>
      <SelectContent className="bg-popover z-50 max-h-60">
        {rooms.map((r) => (
          <SelectItem key={r.fm_guid} value={r.fm_guid}>
            {r.common_name || r.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
)}
```

**Position Picker Button:**
```tsx
<div className="space-y-2">
  <Label>3D Position</Label>
  {coordinates ? (
    <div className="bg-muted/50 rounded-lg p-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Crosshair className="h-4 w-4 text-primary" />
        <span className="font-mono text-sm">
          X: {coordinates.x.toFixed(2)} Y: {coordinates.y.toFixed(2)} Z: {coordinates.z.toFixed(2)}
        </span>
      </div>
      <Button variant="ghost" size="icon" onClick={() => setCoordinates(null)}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  ) : (
    <Button
      type="button"
      variant="outline"
      onClick={() => setPositionDialogOpen(true)}
      disabled={!buildingFmGuid}
      className="w-full h-12"
    >
      <Crosshair className="h-4 w-4 mr-2" />
      Välj position i 3D
    </Button>
  )}
</div>
```

---

## PositionPickerDialog.tsx - Ny komponent

```tsx
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import AssetPlusViewer from '@/components/viewer/AssetPlusViewer';
import { NavigatorNode } from '@/components/navigator/TreeNode';

interface PositionPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildingFmGuid: string;
  roomFmGuid?: string;
  onPositionPicked: (coords: { x: number; y: number; z: number }) => void;
}

const PositionPickerDialog: React.FC<PositionPickerDialogProps> = ({
  open,
  onOpenChange,
  buildingFmGuid,
  roomFmGuid,
  onPositionPicked,
}) => {
  const handleCoordinatePicked = (
    coords: { x: number; y: number; z: number },
    parentNode: NavigatorNode | null
  ) => {
    onPositionPicked(coords);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] h-[85vh] p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle>Välj position i 3D-modellen</DialogTitle>
        </DialogHeader>
        <div className="flex-1 h-full min-h-0">
          <AssetPlusViewer
            fmGuid={roomFmGuid || buildingFmGuid}
            pickModeEnabled={true}
            onCoordinatePicked={handleCoordinatePicked}
            onClose={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PositionPickerDialog;
```

---

## Framtida förbättringar (ej i denna implementation)

1. **360+ deep-linking från AssetsView** - Lägg till View-ikon på assets med `ivion_poi_id` som öppnar Ivion
2. **Automatisk POI-synk** - Synka skapade assets till Ivion som POIs
3. **Ivion room-navigation** - Navigera till specifikt rum i Ivion baserat på `room_fm_guid`

---

## Testning

Efter implementation:
1. Öppna `/ivion-create?siteId=test&name=Testbrandsläckare`
2. Välj en byggnad → kontrollera att våningar laddas
3. Välj våning → kontrollera att rum laddas
4. Klicka "Välj position i 3D" → kontrollera att 3D-viewer öppnas
5. Klicka på en yta → kontrollera att koordinater sparas
6. Spara asset → kontrollera att alla fält sparas korrekt i databasen
