
# Plan: Förbättra Detaljlistor, XKT-synkning och Profilinställningar

## Sammanfattning av Identifierade Problem

1. **Kolumnval fungerar dåligt** - Sheet-baserad kolumnväljare är svår att använda
2. **Multi-selektion saknas** - Kan inte markera flera rader för batch-redigering
3. **Kolumnbredder** - Fasta bredder, ingen justering möjlig
4. **Åtgärder tar plats längst ned** - Borde flyttas till verktygsfält högst upp
5. **Visa/redigera egenskaper saknas** - Ingen modal för att visa alla egenskaper
6. **Placera annotation villkorad** - Ska bara visas för assets med "Finns i modell = Nej"
7. **XKT-synkning fungerar inte** - Backend-sync misslyckas, behöver preload-strategi
8. **Tema till Profile** - Flytta tema-val från User dropdown till dedikerad Profile-sektion med namn/foto

---

## Del 1: Förbättra Kolumnväljaren

### Problem
Den nuvarande Sheet-baserade kolumnväljaren (`ColumnSelectorTree`) är svår att använda och kräver att man öppnar en sidopanel.

### Lösning
Ersätt Sheet med en DropdownMenu som har bättre interaktion:

**Filer att ändra:**
- `src/components/portfolio/AssetsView.tsx`
- `src/components/portfolio/RoomsView.tsx`

```text
Nuvarande UI:
┌─────────────────────────────────────────┐
│ [Kolumner] → Öppnar Sheet → svårt att  │
│                              navigera   │
└─────────────────────────────────────────┘

Ny UI:
┌─────────────────────────────────────────┐
│ [▼ Kolumner] → DropdownMenuCheckboxItem │
│  ☑ Beteckning                          │
│  ☑ Namn                                │
│  ☐ Typ                                 │
│  ☑ Våning                              │
│  ─────────────────                      │
│  ☐ FMGUID                              │
│  ☑ I modell                            │
└─────────────────────────────────────────┘
```

---

## Del 2: Multi-selektion i Listorna

### Problem
Kan inte välja flera rader för batch-operationer som redigering eller synkning.

### Lösning
Lägg till en checkbox-kolumn längst till vänster och en `selectedRows` state.

**Filer att ändra:**
- `src/components/portfolio/AssetsView.tsx`
- `src/components/portfolio/RoomsView.tsx`

```typescript
// Ny state
const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

// Checkbox i header för "välj alla"
<TableHead className="w-10">
  <Checkbox 
    checked={selectedRows.size === filteredAssets.length}
    onCheckedChange={(checked) => {
      if (checked) {
        setSelectedRows(new Set(filteredAssets.map(a => a.fmGuid)));
      } else {
        setSelectedRows(new Set());
      }
    }}
  />
</TableHead>

// Checkbox per rad
<TableCell className="py-2 w-10">
  <Checkbox 
    checked={selectedRows.has(asset.fmGuid)}
    onCheckedChange={(checked) => {
      const newSet = new Set(selectedRows);
      if (checked) newSet.add(asset.fmGuid);
      else newSet.delete(asset.fmGuid);
      setSelectedRows(newSet);
    }}
  />
</TableCell>
```

---

## Del 3: Justerbara Kolumnbredder

### Problem
Kolumnerna har fasta bredder, kan inte justeras.

### Lösning
1. **Smartare standardbredder** baserat på innehåll (max-tecken)
2. **Drag-resize** genom att lägga till resize-handles

**Teknisk implementering:**

```typescript
// Ny state för kolumnbredder
const [columnWidths, setColumnWidths] = useState<Record<string, number>>({
  designation: 150,
  commonName: 180,
  assetType: 120,
  levelCommonName: 100,
  createdInModel: 80,
  // etc.
});

// Auto-calculate baserat på innehåll
const calculateColumnWidth = (colKey: string, data: any[]): number => {
  const maxChars = Math.max(
    colKey.length,
    ...data.map(d => String(d[colKey] || '').length)
  );
  return Math.min(300, Math.max(60, maxChars * 8 + 24)); // padding
};
```

---

## Del 4: Flytta Åtgärder till Verktygsfält

### Problem
Åtgärder per rad tar plats och kommer bli fler. Borde samlas i ett verktygsfält.

### Lösning
Skapa ett kontextuellt verktygsfält som visas när rader är markerade:

```text
┌─────────────────────────────────────────────────────────────────┐
│ 🔍 Sök...  [Filter ▼] [Kolumner ▼]                     [Grid][List]  │
├─────────────────────────────────────────────────────────────────┤
│ ✓ 3 markerade │ [📋 Egenskaper] [📍 Placera] [🔄 Synka] [✕ Avmarkera]│
└─────────────────────────────────────────────────────────────────┘
```

**Filer att ändra:**
- `src/components/portfolio/AssetsView.tsx`
- `src/components/portfolio/RoomsView.tsx`

```typescript
// Kontextuellt verktygsfält som visas när selectedRows.size > 0
{selectedRows.size > 0 && (
  <div className="border-b px-4 py-2 flex items-center gap-2 bg-muted/50">
    <Badge variant="secondary">{selectedRows.size} markerade</Badge>
    <Button size="sm" variant="outline" onClick={handleShowProperties}>
      <Info size={14} className="mr-1" /> Egenskaper
    </Button>
    <Button size="sm" variant="outline" onClick={handleBatchPlaceAnnotation}>
      <MapPin size={14} className="mr-1" /> Placera
    </Button>
    <Button size="sm" variant="outline" onClick={handleBatchSync}>
      <RefreshCw size={14} className="mr-1" /> Synka
    </Button>
    <Button size="sm" variant="ghost" onClick={() => setSelectedRows(new Set())}>
      <X size={14} className="mr-1" /> Avmarkera
    </Button>
  </div>
)}
```

---

## Del 5: Visa Egenskaper och Redigera

### Problem
Saknar möjlighet att se alla egenskaper för valda objekt.

### Lösning
Återanvänd och utöka `UniversalPropertiesDialog` för att stödja:
1. Visa alla egenskaper
2. Redigera läge (ny prop)

**Filer att ändra:**
- `src/components/common/UniversalPropertiesDialog.tsx`
- `src/components/portfolio/AssetsView.tsx`

```typescript
// I AssetsView - visa dialog för valda rader
const [showPropertiesFor, setShowPropertiesFor] = useState<string[]>([]);

const handleShowProperties = () => {
  setShowPropertiesFor(Array.from(selectedRows));
};

// Ny prop för redigering
<UniversalPropertiesDialog
  fmGuids={showPropertiesFor}
  editable={true}
  onClose={() => setShowPropertiesFor([])}
/>
```

---

## Del 6: Villkorad "Placera Annotation"

### Problem
"Placera annotation"-knappen visas för alla assets, borde bara visas för de som saknar position.

### Nuvarande kod (rad 746-756 i AssetsView):
```typescript
{!asset.annotationPlaced && (
  <Button onClick={() => handlePlaceAnnotation(asset)}>
    <MapPin size={14} />
  </Button>
)}
```

### Ändring
Behåll nuvarande logik - den är redan korrekt! Den visar bara knappen om `annotationPlaced === false`. Men lägg till ytterligare villkor för `createdInModel`:

```typescript
{!asset.createdInModel && !asset.annotationPlaced && (
  // Visa bara för assets som INTE finns i modell OCH saknar annotation
)}
```

---

## Del 7: XKT-synkning och Preload

### Problem
1. Synkfunktionen i Settings misslyckas (API-endpoints hittas inte)
2. XKT tar lång tid att ladda när 3D-viewern öppnas

### Lösning - Tvådelad

#### A) Fixa Backend-synk (`asset-plus-sync`)

Problemet verkar vara att `/api/threed/GetModels` returnerar 404. Edge-funktionen försöker redan flera paths, men missar kanske rätt endpoint.

**Debugging-steg:**
1. Logga exakt vilken URL som används
2. Testa med curl mot Asset+ API direkt
3. Verifiera att `ASSET_PLUS_API_URL` pekar på rätt base URL

**Fil att ändra:**
- `supabase/functions/asset-plus-sync/index.ts`

#### B) Förbättra Preload-hook

Nuvarande `useXktPreload` hook fungerar men behöver:
1. **Aktiveras tidigare** - när användare väljer byggnad i Portfolio, inte bara i FacilityLandingPage
2. **Spara till Supabase** med datumkontroll

**Filer att ändra:**
- `src/hooks/useXktPreload.ts`
- `src/components/portfolio/PortfolioView.tsx`
- `src/components/navigator/NavigatorView.tsx`

```typescript
// I PortfolioView - trigga preload när byggnad väljs
const { selectedBuilding } = useContext(AppContext);
useXktPreload(selectedBuilding?.fmGuid);
```

#### C) Datumkontroll för Cached XKT

Lägg till kontroll så att cachad XKT jämförs mot källans senaste uppdatering:

```typescript
// I xkt-cache-service.ts
async checkCacheFreshness(modelId: string, buildingFmGuid: string, sourceModifiedDate?: Date): Promise<boolean> {
  const { data } = await supabase
    .from('xkt_models')
    .select('synced_at')
    .eq('building_fm_guid', buildingFmGuid)
    .eq('model_id', modelId)
    .maybeSingle();

  if (!data) return false; // Not cached

  if (sourceModifiedDate) {
    // Compare dates
    return new Date(data.synced_at) >= sourceModifiedDate;
  }

  return true; // Assume fresh if no source date
}
```

---

## Del 8: Flytta Tema till Profile

### Problem
Tema-växlaren (Dark/Light/SWG) ligger i User dropdown. Ska flyttas till en dedikerad Profile-sektion med möjlighet att lägga till namn och foto.

### Nuvarande UI (AppHeader rad 202-229)
Tema-knappar i dropdown-menyn under User.

### Lösning
1. **Skapa ny Profile-komponent** eller utöka ApiSettingsModal med en "Profile"-tab
2. **Flytta tema** från dropdown till Profile
3. **Lägg till namn/foto** med localStorage-lagring (ingen auth än)

**Filer att ändra:**
- `src/components/layout/AppHeader.tsx` (ta bort tema härifrån)
- `src/components/settings/ApiSettingsModal.tsx` (lägg till Profile-tab)

**Ny Profile-tab innehåll:**
```text
┌─────────────────────────────────────────────────────────────────┐
│ Profile                                                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────┐                                                       │
│  │ 📷   │  Klicka för att ladda upp foto                       │
│  └──────┘                                                       │
│                                                                 │
│  Namn: ___________________                                      │
│  E-post: _________________ (informativt)                        │
│                                                                 │
│  ─────────────────────────────────                              │
│  Tema:                                                          │
│  ┌──────┐  ┌──────┐  ┌──────┐                                  │
│  │ Dark │  │Light │  │ SWG  │                                  │
│  └──────┘  └──────┘  └──────┘                                  │
│                                                                 │
│                                            [Spara]              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementeringsordning

| Fas | Uppgift | Prioritet |
|-----|---------|-----------|
| 1 | Multi-selektion + checkbox-kolumn | Hög |
| 2 | Flytta åtgärder till verktygsfält | Hög |
| 3 | Förbättra kolumnväljare (dropdown istället för sheet) | Medium |
| 4 | Visa egenskaper-dialog för markerade | Medium |
| 5 | Villkorad "Placera annotation" | Låg (redan delvis rätt) |
| 6 | Kolumnbredder - smartare defaults | Medium |
| 7 | XKT preload i fler komponenter | Hög |
| 8 | Fixa XKT sync endpoint-logik | Hög |
| 9 | Profile-tab med tema/namn/foto | Medium |

---

## Filer som Påverkas

| Fil | Ändringar |
|-----|-----------|
| `src/components/portfolio/AssetsView.tsx` | Multi-select, toolbar, kolumnväljare, egenskaper |
| `src/components/portfolio/RoomsView.tsx` | Multi-select, toolbar, kolumnväljare |
| `src/components/portfolio/PortfolioView.tsx` | Aktivera XKT preload |
| `src/components/navigator/NavigatorView.tsx` | Aktivera XKT preload |
| `src/hooks/useXktPreload.ts` | Bättre cache-kontroll |
| `src/services/xkt-cache-service.ts` | Datumkontroll för freshness |
| `src/components/settings/ApiSettingsModal.tsx` | Ny Profile-tab |
| `src/components/layout/AppHeader.tsx` | Ta bort tema från dropdown |
| `src/components/common/UniversalPropertiesDialog.tsx` | Stöd för multi-select och redigering |
| `supabase/functions/asset-plus-sync/index.ts` | Debugging/fix för XKT endpoints |

---

## Tekniska Detaljer

### localStorage för Profile
```typescript
interface UserProfile {
  displayName: string;
  avatarUrl: string | null;
  theme: 'dark' | 'light' | 'swg';
}

// Spara
localStorage.setItem('userProfile', JSON.stringify(profile));

// Läsa (i AppContext)
const savedProfile = localStorage.getItem('userProfile');
if (savedProfile) {
  const profile = JSON.parse(savedProfile);
  setTheme(profile.theme);
  // etc.
}
```

### XKT Preload Trigger Points

```text
1. FacilityLandingPage (redan aktiv)
2. PortfolioView → när byggnad klickas
3. NavigatorView → när byggnad expanderas
4. MapView → när byggnad väljs på kartan
```

---

## Förväntat Resultat

1. **Kolumnval fungerar bra** - Snabb dropdown med checkboxar
2. **Multi-selektion möjlig** - Checkbox-kolumn med batch-åtgärder
3. **Justerbara bredder** - Smartare defaults, möjligen resize
4. **Åtgärder i toolbar** - Kontextuellt verktygsfält för markerade
5. **Egenskaper visas** - Modal för att se/redigera alla egenskaper
6. **Annotation villkorad** - Bara för assets utan modell-position
7. **XKT laddar snabbare** - Preload vid byggnadsval + fungerande sync
8. **Profil med tema** - Dedikerad sektion för personliga inställningar
