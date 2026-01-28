

# Plan: Fixa 3D-positionsval, Spara-knapp, Bild-uppladdning och Annotation-synlighet

## Identifierade problem

### Problem 1: "Select Object" är förvalt i 3D
- **Orsak**: I `ViewerToolbar.tsx` (rad 75) sätts `activeTool` till `'select'` som default
- **Effekt**: När användaren navigerar för att välja position så markeras objekt oavsiktligt
- **Lösning**: I pick-mode bör inget verktyg vara aktivt (`null`) så att användaren kan navigera fritt

### Problem 2: Ingen annotation-symbol visas vid vald position
- **Orsak**: Det finns ingen logik som visar en temporär markör vid klickad position
- **Lösning**: Lägg till en visuell markör (använd Asset+ annotation API eller xeokit Entity) vid den valda positionen. Aktivera även "Visa Annotationer" automatiskt om den är avstängd

### Problem 3: 3D stängs vid bekräftelse av position
- **Orsak**: I `Inline3dPositionPicker.tsx` rad 37-39 anropas `onClose()` direkt efter `onPositionConfirmed()`
- **Effekt**: 3D-vyn försvinner innan användaren fyller i formuläret
- **Lösning**: Ta bort `onClose()` från bekräfta-handlingen. Låt 3D-vyn ligga kvar. Stäng 3D-vyn först när formuläret sparas

### Problem 4: Spara-knappen fungerar inte
- **Möjlig orsak 1**: Formuläret har `type="submit"` men `handleSubmit` kanske inte triggas korrekt
- **Möjlig orsak 2**: RLS-policy problem (men verifierat att INSERT har `with_check: true` för public)
- **Lösning**: Verifiera att form-elementet har korrekt `onSubmit` handler och att alla required fält valideras korrekt

### Problem 5: Ta foto/Ladda upp bild fungerar inte
- **Möjlig orsak**: Hidden file input-elementens `click()` anrop kanske blockeras eller input-refs är `null`
- **Lösning**: Verifiera att refs kopplas korrekt och att `onClick` handler triggar rätt input

---

## Detaljerad implementation

### Del 1: Inaktivera Select Tool vid pick-mode

**Fil: `src/components/inventory/Inline3dPositionPicker.tsx`**

Skicka en prop eller event till AssetPlusViewer som indikerar att standardverktyget inte ska vara "select":

```typescript
<AssetPlusViewer
  fmGuid={targetFmGuid}
  pickModeEnabled={pickModeActive && !pendingCoords}
  disableSelectTool={true}  // NY PROP
  onCoordinatePicked={handleCoordinatePicked}
  onClose={onClose}
/>
```

**Fil: `src/components/viewer/AssetPlusViewer.tsx`**

Lägg till prop `disableSelectTool` och skicka vidare till ViewerToolbar via context eller prop

**Fil: `src/components/viewer/ViewerToolbar.tsx`**

Ändra initial state för `activeTool` baserat på prop:

```typescript
const [activeTool, setActiveTool] = useState<ViewerTool>(
  props.disableSelectTool ? null : 'select'
);
```

### Del 2: Aktivera annotationer automatiskt och visa markör vid vald position

**Fil: `src/components/viewer/AssetPlusViewer.tsx`**

När en position väljs i pick-mode:
1. Kontrollera om `showAnnotations` är false
2. Om ja, anropa `viewer.onToggleAnnotation(true)` och uppdatera state
3. Skapa en temporär annotation/markör vid de valda koordinaterna

```typescript
// I handleCoordinatePicked (i setupPickModeListenerInternal):
// Aktivera annotationer om de är dolda
if (!showAnnotations) {
  const assetViewer = viewerInstanceRef.current?.assetViewer;
  if (assetViewer?.onToggleAnnotation) {
    assetViewer.onToggleAnnotation(true);
    setShowAnnotations(true);
  }
}

// Skapa temporär markör vid positionen
// Asset+ viewer har createTemporaryAnnotation eller liknande API
```

### Del 3: Låt 3D-vyn ligga kvar tills formuläret sparas

**Fil: `src/components/inventory/Inline3dPositionPicker.tsx`**

Ta bort `onClose()` från bekräfta-handlingen:

```typescript
const handleConfirm = () => {
  if (pendingCoords) {
    onPositionConfirmed(pendingCoords);
    // REMOVED: onClose(); - Låt 3D-vyn ligga kvar
  }
};
```

**Fil: `src/pages/Inventory.tsx`**

Uppdatera `handleSaved` för att stänga 3D-vyn när formuläret sparas:

```typescript
const handleSaved = (item: InventoryItem) => {
  // ... befintlig logik ...
  
  // Stäng 3D-viewer efter spara
  setViewer3dOpen(false);
  setViewer3dBuildingFmGuid(null);
  setViewer3dRoomFmGuid(null);
  
  // Reload to get fresh data
  loadRecentItems();
};
```

### Del 4: Felsök Spara-knappen

**Fil: `src/components/inventory/InventoryForm.tsx`**

Formuläret ser korrekt ut med `<form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>` och `<Button type="submit">`.

Lägg till console.log för debugging:

```typescript
const handleSubmit = async () => {
  console.log('handleSubmit called');
  // ... resten av koden
};
```

Kontrollera att valideringen inte blockerar submit:
- `name.trim()` - OK
- `category` - Kräver val
- `symbolId` - Kräver val
- `buildingFmGuid` - Kräver val

### Del 5: Felsök Ta foto / Ladda upp bild

**Fil: `src/components/inventory/ImageUpload.tsx`**

Koden ser korrekt ut. Möjliga problem:
1. `cameraInputRef.current` eller `fileInputRef.current` är `null`
2. `capture="environment"` fungerar inte på alla enheter

Lägg till debugging:

```typescript
const handleCameraClick = () => {
  console.log('Camera button clicked, ref:', cameraInputRef.current);
  cameraInputRef.current?.click();
};

const handleUploadClick = () => {
  console.log('Upload button clicked, ref:', fileInputRef.current);
  fileInputRef.current?.click();
};
```

Och uppdatera button onClick:

```typescript
<Button onClick={handleCameraClick}>
```

---

## Sammanfattning av filändringar

| Fil | Ändring |
|-----|---------|
| `src/components/inventory/Inline3dPositionPicker.tsx` | Ta bort `onClose()` från bekräfta, lägg till `disableSelectTool` prop |
| `src/pages/Inventory.tsx` | Stäng 3D-viewer i `handleSaved` |
| `src/components/viewer/AssetPlusViewer.tsx` | Lägg till `disableSelectTool` prop, aktivera annotationer automatiskt vid pick, visa temporär markör |
| `src/components/viewer/ViewerToolbar.tsx` | Respektera `disableSelectTool` prop för initial tool state |
| `src/components/inventory/ImageUpload.tsx` | Lägg till debugging/förbättra button click handlers |

---

## Visuellt flöde efter fix

```text
1. Användare klickar "Välj 3D-position" i formuläret
2. 3D öppnas till höger (inget verktyg aktivt, kan navigera fritt)
3. Användare klickar "Börja välja"
4. Användare klickar på en yta
5. Annotation-symbol visas vid positionen (annotationer aktiveras automatiskt)
6. Koordinater visas i header-bar
7. Användare kan klicka "Välj ny" eller fortsätta
8. Användare fyller i formuläret (3D kvar till höger)
9. Användare klickar "Spara"
10. Asset sparas och 3D stängs
```

---

## Tekniska detaljer

### ViewerToolbar default tool

Ändra rad 75 i ViewerToolbar.tsx:

```typescript
// Före:
const [activeTool, setActiveTool] = useState<ViewerTool>('select');

// Efter (med prop):
interface ViewerToolbarProps {
  // ... befintliga
  disableSelectTool?: boolean;
}

const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  // ... befintliga
  disableSelectTool = false,
}) => {
  const [activeTool, setActiveTool] = useState<ViewerTool>(
    disableSelectTool ? null : 'select'
  );
```

### Auto-enable annotations

I AssetPlusViewer, lägg till i pick-resultats handler:

```typescript
// Säkerställ att annotationer är synliga när position väljs
if (!showAnnotations) {
  try {
    const assetViewer = viewerInstanceRef.current?.assetViewer;
    if (assetViewer?.onToggleAnnotation) {
      assetViewer.onToggleAnnotation(true);
      setShowAnnotations(true);
      console.log('Annotations auto-enabled for position picking');
    }
  } catch (e) {
    console.debug('Could not auto-enable annotations:', e);
  }
}
```

