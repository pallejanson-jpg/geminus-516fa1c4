
# Plan: Fixa Krasch i Mobil Inventering vid Val av Våningsplan

## Sammanfattning av Identifierade Problem

### Problem 1: Krasch vid val av "Inget specifikt rum"
**Grundorsak:** Rad 189 i `LocationSelectionStep.tsx` har `<SelectItem value="">` med tom sträng som värde. Radix UI Select-komponenten hanterar inte tomma strängar korrekt och kan krascha.

**Bevis:**
```tsx
<SelectItem value="" className="py-3">
  Inget specifikt rum
</SelectItem>
```

**Lösning:** Byt ut tom sträng mot ett speciellt värde som `"__none__"` och hantera det i `onChange`:
```tsx
<SelectItem value="__none__" className="py-3">
  Inget specifikt rum
</SelectItem>
```

### Problem 2: Saknade våningsplan / laddningsproblem
**Symptom:** Inte alla våningsplan visas i mobil-inventering.

**Grundorsak:** `LocationSelectionStep.tsx` använder `navigatorTreeData` från `AppContext`, men kontrollerar INTE om data fortfarande laddas (`isLoadingData`). Med 47 000+ objekt tar inläsningen flera sekunder, och om användaren öppnar inventering innan det är klart visas inga byggnader eller våningsplan.

**Databasverifiering:**
- 14 Buildings i databasen
- 87 Building Storeys
- Centralstationen har 16 våningsplan

**Lösning:** 
1. Lägg till `isLoadingData` i LocationSelectionStep
2. Visa loading-indikator om data laddas
3. Alternativt: trigga refresh om data är tom

---

## Teknisk Implementering

### Steg 1: Fixa tomt SelectItem-värde

**Fil:** `src/components/inventory/mobile/LocationSelectionStep.tsx`

**Nuvarande kod (rad 184-199):**
```tsx
<Select value={formData.roomFmGuid} onValueChange={handleRoomChange}>
  <SelectTrigger className="h-14 text-base">
    <SelectValue placeholder="Välj rum..." />
  </SelectTrigger>
  <SelectContent className="bg-popover z-50 max-h-64">
    <SelectItem value="" className="py-3">
      Inget specifikt rum
    </SelectItem>
    {rooms.map((room) => (
      <SelectItem key={room.fmGuid} value={room.fmGuid} className="py-3">
        {room.commonName || room.name}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

**Ändring:**
```tsx
const NONE_VALUE = "__none__"; // Konstant för "inget rum valt"

const handleRoomChange = (fmGuid: string) => {
  if (fmGuid === NONE_VALUE) {
    updateFormData({
      roomFmGuid: '',
      roomName: '',
    });
    return;
  }
  const room = rooms.find((r) => r.fmGuid === fmGuid);
  updateFormData({
    roomFmGuid: fmGuid,
    roomName: room?.commonName || room?.name || '',
  });
};

// I JSX:
<Select 
  value={formData.roomFmGuid || NONE_VALUE} 
  onValueChange={handleRoomChange}
>
  ...
  <SelectItem value={NONE_VALUE} className="py-3">
    Inget specifikt rum
  </SelectItem>
  ...
</Select>
```

### Steg 2: Lägg till loading-kontroll

**Fil:** `src/components/inventory/mobile/LocationSelectionStep.tsx`

**Nuvarande kod (rad 32):**
```tsx
const { navigatorTreeData } = useContext(AppContext);
```

**Ändring:**
```tsx
const { navigatorTreeData, isLoadingData, refreshInitialData } = useContext(AppContext);

// Om data laddas - visa skeleton/loading
if (isLoadingData) {
  return (
    <div className="p-4 space-y-4">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <p className="text-center text-muted-foreground">Laddar byggnader...</p>
    </div>
  );
}

// Om data är tom efter laddning - trigga refresh och visa meddelande
if (!isLoadingData && navigatorTreeData.length === 0) {
  return (
    <div className="p-4 space-y-4 flex flex-col items-center justify-center h-full">
      <Building2 className="h-12 w-12 text-muted-foreground" />
      <p className="text-muted-foreground text-center">
        Ingen data hittades. Kontrollera att synkronisering har genomförts i Inställningar.
      </p>
      <Button variant="outline" onClick={() => refreshInitialData()}>
        Försök igen
      </Button>
    </div>
  );
}
```

---

## Filer som Påverkas

| Fil | Ändringar |
|-----|-----------|
| `src/components/inventory/mobile/LocationSelectionStep.tsx` | Fixa tomt SelectItem-värde, lägg till loading-kontroll |

---

## Verifiering

1. Öppna mobil inventering
2. Verifiera att loading-indikator visas om data laddas
3. Välj byggnad → verifiera att alla våningsplan visas
4. Välj våningsplan → verifiera ingen krasch
5. I rum-dropdown, välj "Inget specifikt rum" → verifiera ingen krasch
6. Fortsätt genom wizard → verifiera att registration fungerar

---

## Relaterat: XKT-synkning

Användaren nämnde att "fulla synken inte fungerar". Detta är ett separat problem som handlar om XKT-modellsynkronisering i `asset-plus-sync` edge function, inte om byggnads-/våningsdata. Byggnader och Building Storeys synkas separat (ObjectTypes 1-2) och fungerar - det finns 14 buildings och 87 storeys i databasen.

Om alla våningsplan ändå inte visas efter denna fix kan det bero på:
1. Att träd-byggnadsfunktionen (`buildNavigatorTree`) filtrerar bort våningar som saknar korrekt `buildingFmGuid`
2. Race condition om användaren öppnar inventering innan `refreshInitialData` avslutas
