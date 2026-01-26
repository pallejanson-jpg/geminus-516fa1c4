
# Plan: UI/UX-förbättringar för 3D-viewer och rumslistor

## Sammanfattning
Denna plan åtgärdar sex separata problem som identifierats i gränssnittet:
1. Responsivitet i "Anpassa verktygsfält" dialog
2. Höger meny i 3D-viewern fungerar inte och är felplacerad
3. Ingen landningssida för rum vid val från rumslista
4. Två kolumnväljare i rumslistan - ta bort en och förbättra den andra
5. Mobil responsivitet i rumslistan
6. 3D-viewern kan maximeras till helskärm

---

## Problem 1: Responsivitet i "Anpassa verktygsfält"

### Nuvarande läge
`ToolbarSettings.tsx` (rad 271-315) använder en `Dialog` med fast bredd `sm:max-w-lg` och en `ScrollArea` med fast höjd `h-[400px]`. På mobil kan detta orsaka overflow-problem.

### Lösning
Förbättra dialogens responsivitet:
- Mobil: Fullskärm med flexibel höjd
- Lägg till mobilanpassade element (större touch-targets)
- Säkerställ att dra-och-släpp fungerar på touchskärmar

**Fil**: `src/components/viewer/ToolbarSettings.tsx`

```text
Rad 273: Ändra från:
className="sm:max-w-lg max-h-[85vh]"

Till:
className="w-full sm:max-w-lg max-h-[90vh] flex flex-col"

Rad 282: Ändra från:
<ScrollArea className="h-[400px] pr-4">

Till:
<ScrollArea className="flex-1 max-h-[50vh] sm:max-h-[400px] pr-4">
```

---

## Problem 2: Höger meny (VisualizationToolbar) fungerar inte

### Nuvarande läge
`VisualizationToolbar.tsx` (rad 240-241) positionerar knappen:
```jsx
<div className="absolute top-1/2 -translate-y-1/2 right-3 z-30">
```

Knappen är placerad i mitten vertikalt, vilket kan krocka med andra UI-element. Dessutom kan den vara svår att hitta.

### Identifierade problem
1. **Z-index konflikt**: NavCube canvas har `z-index: 25` (rad 1095 i AssetPlusViewer), medan toolbar har `z-30`, men NavCube ligger i `bottom: 70px, right: 12px` och kan överlappa
2. **Positionering**: Knappen är i mitten av skärmen istället för uppe i hörnet
3. **Sheet-innehållet**: `SheetContent` har `w-80` vilket kan vara för smalt på vissa skärmar

### Lösning
Flytta knappen till övre högra hörnet och säkerställ korrekt z-index:

**Fil**: `src/components/viewer/VisualizationToolbar.tsx`

```text
Rad 240-241: Ändra från:
<div className={cn("absolute top-1/2 -translate-y-1/2 right-3 z-30", className)}>

Till:
<div className={cn("absolute top-4 right-14 z-30", className)}>
```

Justering: `right-14` för att inte kollidera med AnnotationToggleMenu som redan finns i `top-2 right-2`.

---

## Problem 3: Ingen landningssida för rum

### Nuvarande läge
När användaren väljer ett rum i `RoomsView` anropas `handleOpen3D` (rad 450-454) som direkt öppnar 3D-viewern utan att visa rummets landningssida.

I `PortfolioView.tsx` (rad 209-213):
```javascript
const handleOpen3DRoom = (fmGuid: string, levelFmGuid?: string) => {
  setViewer3dFmGuid(fmGuid);
  setShowRoomsFor(null);
  // Ingen setSelectedFacility()!
};
```

### Lösning
Lägg till möjlighet att öppna landningssida för rum via ett klick på raden/kortet, och behåll 3D-knappen för direkt 3D-navigering:

**Fil**: `src/components/portfolio/RoomsView.tsx`

Lägg till ny prop och handler:
```text
Rad 76: Lägg till ny prop:
onSelectRoom?: (fmGuid: string) => void;

Rad 450-454: Lägg till ny handler:
const handleSelectRoom = (room: RoomData) => {
  if (onSelectRoom) {
    onSelectRoom(room.fmGuid);
  }
};
```

**Fil**: `src/components/portfolio/PortfolioView.tsx`

```text
Rad 209-213: Lägg till handler för rumsvalet:
const handleSelectRoom = (fmGuid: string) => {
  const room = allData.find((a: any) => a.fmGuid === fmGuid);
  if (room) {
    setSelectedFacility(room);
    setShowRoomsFor(null);
  }
};

Rad 241-246: Lägg till prop:
<RoomsView
  ...
  onSelectRoom={handleSelectRoom}
/>
```

**Beteendeändring**:
- Klick på rad/kort → Öppnar landningssida (FacilityLandingPage för rum)
- Klick på 3D-ikon → Öppnar 3D-viewer direkt

---

## Problem 4: Två kolumnväljare i rumslistan

### Nuvarande läge
`RoomsView.tsx` har två separata kolumnväljare:
1. **Sheet-baserad** (rad 526-556): Fullständig trädmeny med kategorier
2. **DropdownMenu** (rad 559-581): "Snabbval kolumner" med de första 20 kolumnerna

### Lösning
Ta bort dropdown-menyn och förbättra Sheet-menyn med:
- Möjlighet att sortera ordningen via drag-and-drop (som ToolbarSettings)
- Tydligare UI för att välja synliga kolumner

**Fil**: `src/components/portfolio/RoomsView.tsx`

1. **Ta bort** rad 558-581 (DropdownMenu för snabbval)

2. **Förbättra ColumnSelectorTree** (rad 172-252) med drag-and-drop:
   - Lägg till `useSortable` för varje kolumn-item
   - Spara ordning i state
   - Visa synliga kolumner först med drag-handtag

**Ny komponent-struktur**:
```text
ColumnSelectorTree:
├── Synliga kolumner (dragbar ordning)
│   ├── [⠿] Rumsnummer [✓]
│   ├── [⠿] Rumsnamn [✓]
│   └── [⠿] Våning [✓]
├── ────────────────────
├── Systemegenskaper (kollapsbar)
│   ├── Kategori [○]
│   └── FMGUID [○]
├── Användardefinierade (kollapsbar)
│   └── Hyresobjekt [○]
└── Beräknade (kollapsbar)
    └── NTA [○]
```

---

## Problem 5: Mobil responsivitet i rumslistan

### Nuvarande läge
- Verktygsfältet (rad 514-605) är redan responsivt med `flex-col sm:flex-row`
- Kolumnväljaren visar text "Kolumner" bara på `sm:inline`
- Men tabellen (rad 611-677) kan ha horisontell scroll-problem

### Lösning
Flytta kolumnväljaren till en hamburgermeny på mobil:

**Fil**: `src/components/portfolio/RoomsView.tsx`

```text
Ny import:
import { Menu } from 'lucide-react';

Rad 524-604: Omstrukturera toolbar för mobil:
<div className="border-b px-4 py-2 flex gap-2 shrink-0">
  <div className="relative flex-1">
    <Search ... />
    <Input ... />
  </div>
  
  {/* Mobile: Hamburger menu */}
  <div className="sm:hidden">
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="h-9 w-9">
          <Menu size={16} />
        </Button>
      </SheetTrigger>
      <SheetContent side="right">
        {/* Kolumnväljare + Vylägesväxlare */}
      </SheetContent>
    </Sheet>
  </div>
  
  {/* Desktop: Inline controls */}
  <div className="hidden sm:flex gap-2">
    {/* Kolumnväljare */}
    {/* Vylägesväxlare */}
  </div>
</div>
```

---

## Problem 6: 3D-viewer kan maximeras till helskärm

### Nuvarande läge
`AssetPlusViewer.tsx` (rad 1040-1044) har en container med padding:
```jsx
<div className="h-full p-2 sm:p-4 md:p-6">
```

I `Viewer.tsx`:
```jsx
<div className="h-full p-2 sm:p-4 md:p-6">
  <AssetPlusViewer ... />
</div>
```

### Lösning
Lägg till en "maximera"-knapp som tar bort padding och fyller hela skärmen:

**Fil**: `src/components/viewer/AssetPlusViewer.tsx`

```text
Ny state:
const [isFullscreen, setIsFullscreen] = useState(false);

Ny knapp i toolbar (nära close-knappen):
<Button 
  variant="secondary" 
  size="icon"
  onClick={() => setIsFullscreen(!isFullscreen)}
  className="..."
>
  {isFullscreen ? <Minimize2 /> : <Maximize2 />}
</Button>

Uppdatera container (rad 1040):
<div className={cn(
  "h-full",
  isFullscreen ? "fixed inset-0 z-50" : "p-2 sm:p-4 md:p-6"
)}>
```

---

## Filändringar

| Fil | Typ | Beskrivning |
|-----|-----|-------------|
| `src/components/viewer/ToolbarSettings.tsx` | Ändra | Förbättra responsivitet för mobil |
| `src/components/viewer/VisualizationToolbar.tsx` | Ändra | Flytta till övre högra hörnet |
| `src/components/portfolio/RoomsView.tsx` | Ändra | Ta bort dubbel kolumnväljare, lägg till drag-drop ordning, mobil hamburgermeny, rumsval-callback |
| `src/components/portfolio/PortfolioView.tsx` | Ändra | Lägg till handler för att öppna rums-landningssida |
| `src/components/viewer/AssetPlusViewer.tsx` | Ändra | Lägg till fullscreen-toggle |

---

## Prioritering

1. **Kritiskt**: Höger meny positionering (5 min)
2. **Viktigt**: Responsivitet i ToolbarSettings (10 min)
3. **Viktigt**: Rums-landningssida (15 min)
4. **Funktion**: Konsolidera kolumnväljare (25 min)
5. **Funktion**: Mobil hamburgermeny för rumslistor (20 min)
6. **Funktion**: 3D-viewer fullscreen (10 min)

**Total uppskattad tid**: ~1.5 timmar

---

## Teknisk implementation (detaljer)

### VisualizationToolbar positionering

Nuvarande position kolliderar potentiellt med NavCube. Ny position:
- `top-4` för att matcha övriga knappar
- `right-14` (56px) för att ge plats åt AnnotationToggleMenu som redan finns i top-right

### Kolumnväljare med drag-and-drop

Använd samma mönster som `ToolbarSettings.tsx`:
- `@dnd-kit/core` och `@dnd-kit/sortable`
- `SortableContext` med `verticalListSortingStrategy`
- Visa endast synliga kolumner i den dragbara listan
- Övriga kolumner visas i kategorier (som idag)

### Fullscreen-implementation

Använd `fixed inset-0 z-50` för att täcka hela viewporten:
- Högre z-index än sidebars och header
- Escape-tangent för att avsluta (redan hanteras av dialog/sheet)
- Behåll alla verktyg och paneler funktionella
