
# Plan: Asset Synkronisering, Inventering Desktop UX & 3D Annotation Placering

## Sammanfattning

Sju förbättringsområden:

1. **Asset+ synk-kompatibilitet** - Obligatoriska fält, datatyper och 128-bitars GUID
2. **Partiell/inkrementell synkning** - Lösa 40k-objekt timeout-problemet  
3. **Fallback-synk per byggnad** - Auto-synk när assets saknas
4. **Desktop-anpassning av Inventory UI** - Bättre layout på större skärmar
5. **Kamera-knapp fix** - Aktivera mobil kamera korrekt
6. **"Ej i modell" indikering** - Visuell markering i asset-listor
7. **3D Annotation placering** - Spara position och visa symbol för orphan assets

---

## Del 1: Asset+ Synk-kompatibilitet

### Problem
Assets skapade lokalt via InventoryForm saknar vissa fält som krävs för att senare synkas till Asset+.

### Asset+ API-krav för ObjectType 4 (Instance)
Baserat på `asset-plus-create/index.ts`:

| Fält | Typ | Obligatoriskt | Beskrivning |
|------|-----|---------------|-------------|
| `fmGuid` | 128-bit UUID | Ja | Unik identifierare |
| `objectType` | int (4) | Ja | Alltid 4 för Instance |
| `designation` | string | Ja | Primärt namn/nummer |
| `inRoomFmGuid` | string | Ja* | Koppling till rum (parent Space) |
| `commonName` | string | Nej | Beskrivande namn |
| `properties` | array | Nej | Utökade egenskaper med dataType |

*Asset+ kräver `inRoomFmGuid` för ObjectType 4, men vi tillåter assets utan rum lokalt för "korridor-assets".

### Nuvarande problem i InventoryForm.tsx
```typescript
// Rad 106 - Använder crypto.randomUUID() som ger korrekt 128-bit UUID
fm_guid: crypto.randomUUID(),

// MEN: saknar mappning till Asset+ properties-format
// MEN: sparar inte `objectType` explicit
// MEN: `category` sätts till 'Instance' - korrekt
```

### Åtgärder

**A. Lägg till explicit objectType i assets-tabellen**
```sql
-- Ny kolumn (valfritt - kan använda category-mappning istället)
-- ALTER TABLE assets ADD COLUMN object_type integer DEFAULT 4;
-- Beslut: Behåll nuvarande category-mappning, objekttyp härleds vid synk
```

**B. Utöka InventoryForm med Asset+ properties-format**
```
Fil: src/components/inventory/InventoryForm.tsx

Vid save, strukturera `attributes` enligt Asset+ format:
{
  objectType: 4,
  designation: name,
  commonName: name,
  inRoomFmGuid: roomFmGuid || null,
  levelFmGuid: levelFmGuid || null,
  buildingFmGuid: buildingFmGuid,
  assetCategory: category, // fire_extinguisher etc
  description: description,
  inventoryDate: new Date().toISOString(),
  imageUrl: imageUrl,
  // Properties array för Asset+ sync
  syncProperties: [
    { name: 'Description', value: description, dataType: 0 }, // String
    { name: 'InventoryDate', value: inventoryDate, dataType: 4 }, // DateTime
  ]
}
```

**C. GUID-validering**
`crypto.randomUUID()` genererar redan RFC 4122 UUID v4 (128-bit) - korrekt för Asset+. Ingen ändring behövs.

---

## Del 2: Partiell/Inkrementell Synkning

### Problem
Synkförsök avbryts vid ~40,000 objekt pga timeout. Den chunked sync-strategin (`sync-assets-chunked`) existerar men används inte alltid.

### Nuvarande strategi i asset-plus-sync/index.ts
- `sync-assets-chunked` (rad 385-452): Bygger redan per byggnad i 500-chunks
- Problem: Fortfarande timeout vid stora byggnader eller många byggnader

### Åtgärder

**A. Lägg till resume-stöd i sync-assets-chunked**
```
Fil: supabase/functions/asset-plus-sync/index.ts

Ny logik:
1. Spara progress i asset_sync_state: { currentBuildingIndex, lastProcessedSkip }
2. Vid timeout/restart: Läs senaste progress och fortsätt därifrån
3. Lägg till max-time-guard (50s) för att avsluta graceful före Supabase timeout
```

**B. Implementera inkrementell synk baserad på dateModified**
```typescript
// I sync-assets-chunked:
// 1. Hämta senaste synced_at från assets för aktuell byggnad
// 2. Skicka dateModified filter till Asset+ API:
const filter = [
  ["buildingFmGuid", "=", building.fm_guid],
  "and",
  ["objectType", "=", 4],
  "and",
  ["dateModified", ">", lastSyncedAt] // Inkrementell
];
```

**C. Ny action: sync-single-building**
```typescript
// Ny action för on-demand synk av en specifik byggnad
if (action === 'sync-single-building') {
  if (!buildingFmGuid) {
    return error('buildingFmGuid required');
  }
  
  await updateSyncState(supabase, `building-${buildingFmGuid}`, 'running');
  
  // Synka endast assets för denna byggnad
  const filter = [
    ["buildingFmGuid", "=", buildingFmGuid],
    "and",
    ["objectType", "=", 4]
  ];
  
  // ... standard pagination loop ...
  
  return { success: true, totalSynced };
}
```

---

## Del 3: Fallback-synk per byggnad

### Problem
När man öppnar assets för en byggnad och inga finns i Supabase, visas tom lista.

### Lösning

**A. Lägg till auto-sync check i FacilityLandingPage**
```
Fil: src/components/portfolio/FacilityLandingPage.tsx

Ny useEffect:
1. När showAssets klickas, kontrollera:
   - Finns assets för denna building_fm_guid i DB?
   - const { count } = await supabase.from('assets').select('*', { count: 'exact', head: true }).eq('building_fm_guid', fmGuid).eq('category', 'Instance');
   
2. Om count === 0:
   - Visa laddningsindikator
   - Anropa edge function: sync-single-building med buildingFmGuid
   - Vänta på resultat
   - Refresha asset-lista
```

**B. Alternativ: Lazy-load i AssetsView**
```
Fil: src/components/portfolio/AssetsView.tsx

Om assets.length === 0 vid mount:
1. Visa "Inga synkade assets - synkar nu..."
2. Trigga sync-single-building
3. Poll för completion
4. Re-fetch assets när klar
```

**C. Ny funktion i asset-plus-service.ts**
```typescript
export async function syncBuildingAssetsIfNeeded(buildingFmGuid: string): Promise<boolean> {
  // Check local count
  const { count } = await supabase
    .from('assets')
    .select('*', { count: 'exact', head: true })
    .eq('building_fm_guid', buildingFmGuid)
    .eq('category', 'Instance');
  
  if (count && count > 0) return false; // Already has assets
  
  // Trigger sync
  const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
    body: { action: 'sync-single-building', buildingFmGuid }
  });
  
  return data?.success ?? false;
}
```

---

## Del 4: Desktop-anpassning av Inventory UI

### Problem
Inventory-sidan är designad för mobil och ser dålig ut på desktop.

### Nuvarande layout (Inventory.tsx)
- Full bredd container
- Sheet från bottom (mobil) eller right (desktop)
- Sheet bredd 450px på desktop

### Åtgärder

**A. Lägg till responsiv grid-layout**
```
Fil: src/pages/Inventory.tsx

Ändra från:
<div className="h-full flex flex-col p-4 space-y-4">

Till:
<div className="h-full flex flex-col lg:flex-row gap-6 p-4 lg:p-8">
  {/* Left column: Saved items list */}
  <div className="flex-1 lg:max-w-md order-2 lg:order-1">
    <InventoryList items={savedItems} isLoading={isLoading} />
  </div>
  
  {/* Right column: Form (always visible on desktop) */}
  <div className="flex-1 order-1 lg:order-2">
    {/* On mobile: Button + Sheet */}
    {/* On desktop: Inline form */}
    {isMobile ? (
      <Button onClick={() => setIsFormOpen(true)}>Ny tillgång</Button>
    ) : (
      <Card className="p-6">
        <InventoryForm onSaved={handleSaved} onCancel={() => {}} prefill={prefill} />
      </Card>
    )}
  </div>
</div>
```

**B. Gör InventoryForm mer desktop-vänlig**
```
Fil: src/components/inventory/InventoryForm.tsx

Lägg till:
- Två-kolumns layout för inputs på desktop
- className="grid grid-cols-1 md:grid-cols-2 gap-4"
- Större touch targets behålls för mobil men mer kompakt på desktop
```

---

## Del 5: Kamera-knapp fix

### Problem
"Ta foto"-knappen aktiverar inte kameran på mobil, den fungerar samma som "Ladda upp".

### Analys av ImageUpload.tsx
```typescript
// Rad 149-156: Båda inputs har samma onChange handler
<input
  ref={cameraInputRef}
  type="file"
  accept="image/*"
  capture="environment"  // <-- Detta BORDE aktivera kameran
  className="hidden"
  onChange={handleFileSelect}
/>
```

### Problem
`capture="environment"` fungerar, men på desktop finns ingen kamera så det fallback:ar till fil-väljare. På mobil bör det fungera - men det kan finnas browserproblem.

### Åtgärder

**A. Villkorlig rendering baserad på enhet**
```
Fil: src/components/inventory/ImageUpload.tsx

import { useIsMobile } from '@/hooks/use-mobile';

// Visa kamera-knappen endast på mobil
{isMobile && (
  <Button onClick={() => cameraInputRef.current?.click()}>
    <Camera /> Ta foto
  </Button>
)}

// På desktop: visa bara Ladda upp
{!isMobile && (
  <Button onClick={() => fileInputRef.current?.click()}>
    <Upload /> Välj bild
  </Button>
)}
```

**B. Alternativt: Lägg till mediaDevices check**
```typescript
const [hasCamera, setHasCamera] = useState(false);

useEffect(() => {
  navigator.mediaDevices?.enumerateDevices?.()
    .then(devices => {
      setHasCamera(devices.some(d => d.kind === 'videoinput'));
    })
    .catch(() => setHasCamera(false));
}, []);

// Visa kamera-knappen endast om enheten har kamera
```

---

## Del 6: "Ej i modell" Indikering

### Problem
När man listar assets vill man se vilka som har `created_in_model = false`.

### Nuvarande status i AssetsView.tsx
Redan implementerat! (Rad 619-623)
```tsx
{!asset.createdInModel && (
  <span title="Ej i modell">
    <AlertCircle className="h-4 w-4 text-amber-500" />
  </span>
)}
```

### Förbättringar

**A. Lägg till samma indikering i InventoryList**
```
Fil: src/components/inventory/InventoryList.tsx

<Card key={item.fm_guid}>
  <div className="flex items-start gap-3">
    <span className="text-xl">{cat.icon}</span>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className="font-medium truncate">{item.name}</p>
        {/* Add "not in model" badge */}
        <Badge variant="outline" className="text-amber-500 border-amber-500 text-xs">
          Ej i modell
        </Badge>
      </div>
      ...
    </div>
  </div>
</Card>
```

**B. Lägg till kolumn i Navigator-trädet**
```
Fil: src/components/navigator/TreeNode.tsx

// Vid rendering av Instance-noder:
{node.category === 'Instance' && !node.createdInModel && (
  <AlertCircle className="h-3 w-3 text-amber-500 ml-1" title="Ej i modell" />
)}
```

---

## Del 7: 3D Annotation Placering för Orphan Assets

### Problem
Assets utan position (`coordinate_x/y/z = null`) kan inte visas i 3D. Behöver möjlighet att placera annotation via 3D-viewer.

### Befintligt stöd
- AssetsView har redan `onPlaceAnnotation` callback (rad 380-389)
- Assets-tabellen har `coordinate_x/y/z`, `annotation_placed`, `symbol_id`
- VisualizationToolbar har "Skapa tillgång" som sätter coordinates

### Flöde

```text
1. Användaren klickar "Placera annotation" (MapPin-ikon) på en orphan asset
2. 3D-viewer öppnas med pick-mode aktiverat
3. Användaren klickar på en yta i 3D
4. Koordinater sparas till assets-tabellen
5. Annotation visas på platsen med vald symbol
```

### Åtgärder

**A. Utöka AppContext med annotation-placement state**
```
Fil: src/context/AppContext.tsx

Lägg till:
interface AnnotationPlacementContext {
  asset: any; // Asset som ska placeras
  buildingFmGuid: string;
}

annotationPlacementContext: AnnotationPlacementContext | null;
startAnnotationPlacement: (asset: any, buildingFmGuid: string) => void;
completeAnnotationPlacement: (coordinates: { x: number; y: number; z: number }) => void;
cancelAnnotationPlacement: () => void;
```

**B. Implementera placement-flow i AssetsView**
```
Fil: src/components/portfolio/AssetsView.tsx

const handlePlaceAnnotation = (asset: AssetData) => {
  // Spara asset i context och öppna viewer
  startAnnotationPlacement(asset.raw, asset.buildingFmGuid);
  setViewer3dFmGuid(asset.buildingFmGuid);
};
```

**C. Lägg till pick-mode i AssetPlusViewer för annotation**
```
Fil: src/components/viewer/AssetPlusViewer.tsx

// Lyssna på annotationPlacementContext
const { annotationPlacementContext, completeAnnotationPlacement } = useContext(AppContext);

// När pick sker och annotationPlacementContext finns:
const handleAnnotationPick = (coordinates: { x, y, z }, parentSpace: string) => {
  if (annotationPlacementContext) {
    // Spara koordinater till databasen
    await supabase.from('assets')
      .update({
        coordinate_x: coordinates.x,
        coordinate_y: coordinates.y,
        coordinate_z: coordinates.z,
        annotation_placed: true,
        in_room_fm_guid: parentSpace, // Auto-assign rum om det kunde identifieras
      })
      .eq('fm_guid', annotationPlacementContext.asset.fm_guid);
    
    // Skapa annotation i viewer
    createAnnotationMarker(coordinates, annotationPlacementContext.asset);
    
    completeAnnotationPlacement(coordinates);
    toast.success('Annotation placerad!');
  }
};
```

**D. Lägg till dynamisk annotation-rendering**
```
Fil: src/components/viewer/AssetPlusViewer.tsx

// Hämta alla assets med koordinater för aktuell byggnad
const loadAssetAnnotations = async () => {
  const { data } = await supabase
    .from('assets')
    .select('fm_guid, name, coordinate_x, coordinate_y, coordinate_z, symbol_id, asset_type')
    .eq('building_fm_guid', buildingFmGuid)
    .eq('annotation_placed', true)
    .not('coordinate_x', 'is', null);
  
  // Skapa xeokit annotations för varje
  data?.forEach(asset => {
    createAnnotationMarker({
      x: asset.coordinate_x,
      y: asset.coordinate_y,
      z: asset.coordinate_z,
    }, asset);
  });
};
```

---

## Filändringar

| Fil | Ändring |
|-----|---------|
| `supabase/functions/asset-plus-sync/index.ts` | Lägg till `sync-single-building`, resume-stöd, inkrementell sync |
| `src/services/asset-plus-service.ts` | Ny `syncBuildingAssetsIfNeeded()` funktion |
| `src/pages/Inventory.tsx` | Responsiv desktop-layout med sidvid-sida |
| `src/components/inventory/InventoryForm.tsx` | Grid-layout för desktop, Asset+ properties-format |
| `src/components/inventory/ImageUpload.tsx` | Villkorlig kamera-knapp baserat på enhet |
| `src/components/inventory/InventoryList.tsx` | "Ej i modell" badge |
| `src/components/portfolio/AssetsView.tsx` | Koppla placeAnnotation till context |
| `src/context/AppContext.tsx` | Lägg till annotationPlacementContext |
| `src/components/viewer/AssetPlusViewer.tsx` | Annotation pick-mode och rendering |
| `src/components/navigator/TreeNode.tsx` | "Ej i modell" ikon |

---

## Leveransordning

1. **GUID & Asset+ format** - Säkerställ attributes har rätt struktur
2. **Sync-single-building** - Ny edge function action
3. **Fallback-synk i UI** - Trigga auto-sync när assets saknas
4. **Desktop Inventory layout** - Responsiv design
5. **Kamera-knapp** - Villkorlig rendering
6. **"Ej i modell" badges** - Visuell indikering
7. **3D Annotation placement** - Full placerings-flow

---

## Tekniska detaljer

### GUID-format
```typescript
// crypto.randomUUID() genererar:
// "550e8400-e29b-41d4-a716-446655440000"
// Detta är 128-bit RFC 4122 UUID v4 - kompatibelt med Asset+
```

### Edge Function Timeout-hantering
```typescript
const MAX_EXECUTION_TIME = 50000; // 50 seconds (Supabase limit is 60s)
const startTime = Date.now();

while (hasMore) {
  if (Date.now() - startTime > MAX_EXECUTION_TIME) {
    // Save progress and exit gracefully
    await updateSyncState(supabase, 'assets', 'interrupted', totalSynced, undefined, {
      resumeData: { buildingIndex: i, skip }
    });
    return { success: true, message: 'Partial sync, will resume', totalSynced, interrupted: true };
  }
  // ... continue sync
}
```

### Annotation Marker Creation
```typescript
const createAnnotationMarker = (coords: {x,y,z}, asset: any) => {
  const annotation = viewer.scene.annotations?.createAnnotation({
    id: asset.fm_guid,
    worldPos: [coords.x, coords.y, coords.z],
    markerShown: true,
    labelShown: false,
    markerHTML: getMarkerHTML(asset.symbol_id, asset.asset_type),
  });
};
```
