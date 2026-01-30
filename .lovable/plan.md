
# Plan: Mobila Förbättringar - Gunnar Minimering, 3D/360 Position & Inventeringslista

## Sammanfattning av Problem

### Problem 1: Gunnar-chatten täcker hela skärmen på mobil
**Nuvarande:** Gunnar öppnas som en stor flytande panel (400×550px) som på mobil tar upp nästan hela skärmen utan möjlighet att minimera.

**Önskat:** Kunna minimera/dölja Gunnar-panelen för att se 3D-vyn bakom när man ber den öppna något.

### Problem 2: Saknar möjlighet att sätta position i 3D/360
**Nuvarande:** Mobil-inventeringen (`MobileInventoryWizard`) har ingen funktion för att välja position i 3D eller 360°. Desktop-versionen har `Inline3dPositionPicker` och `Ivion360View`.

**Önskat:** Kunna välja position i både 3D-modellen och 360-vyn även på mobil.

### Problem 3: Lista på sparade inventarier saknas i mobil
**Nuvarande:** Mobil-wizarden visar bara en badge med antal sparade (`{savedCount} sparade`) men ingen klickbar lista.

**Desktop:** Har en kollapsbar lista (`InventoryList`) där man kan klicka och redigera.

**Önskat:** Få samma funktionalitet på mobil - se lista och kunna redigera registrerade objekt.

---

## Tekniska Lösningar

### Del 1: Minimera-funktion för Gunnar

**Fil:** `src/components/chat/GunnarButton.tsx`

Lägg till ett "minimerat läge" där panelen krymps till en liten bubbla med senaste meddelandet eller bara en ikon som kan expanderas igen.

```typescript
const [isMinimized, setIsMinimized] = useState(false);

// Minimerad vy - liten klickbar bubbla
{isOpen && isMinimized && (
  <div 
    className="fixed bottom-20 right-4 z-[60] cursor-pointer"
    onClick={() => setIsMinimized(false)}
  >
    <div className="bg-card/90 backdrop-blur-lg border rounded-full p-3 shadow-lg flex items-center gap-2">
      <Sparkles className="h-5 w-5 text-primary" />
      <span className="text-sm font-medium max-w-32 truncate">Gunnar</span>
      <Maximize2 className="h-4 w-4 text-muted-foreground" />
    </div>
  </div>
)}

// Lägg till minimera-knapp i header
<Button
  variant="ghost"
  size="icon"
  className="h-7 w-7 hover:bg-muted/50"
  onClick={() => setIsMinimized(true)}
>
  <Minimize2 className="h-4 w-4" />
</Button>
```

**Förväntat resultat:** Användaren kan klicka på minimera-ikonen för att dölja panelen till en liten bubbla, sedan klicka på bubblan för att expandera igen.

---

### Del 2: Lägg till 3D/360 Position i Mobil-Wizard

**Ny fil:** `src/components/inventory/mobile/PositionPickerStep.tsx`

Skapa ett nytt steg i wizarden för att välja position:

```typescript
type WizardStep = 'detection' | 'location' | 'category' | 'position' | 'registration';

// I PositionPickerStep:
// - Visa knappar: "Välj i 3D" och "Välj i 360°"
// - Vid klick: öppna fullskärms-viewer med pick-mode
// - Efter val: spara koordinater och gå vidare
```

**Ändringar i befintliga filer:**

1. **`MobileInventoryWizard.tsx`** - Lägg till `position` som valfritt steg:
   - Lägg till state för `coordinates`
   - Lägg till `PositionPickerStep` komponent
   - Steppet är valfritt - användaren kan hoppa över

2. **`QuickRegistrationStep.tsx`** - Visa valda koordinater om de finns

3. **Integration med 360°:**
   - Kräver att byggnaden har konfigurerat `ivion_site_id` i `building_settings`
   - Öppna Ivion i fullskärmsläge med möjlighet att markera position

**Förväntat resultat:**  
- Användare på mobil kan trycka "Välj i 3D" → fullskärms 3D-viewer öppnas → de klickar på en yta → position sparas
- Samma för 360° om det är konfigurerat

---

### Del 3: Lista på Sparade Inventarier i Mobil

**Fil:** `src/components/inventory/mobile/MobileInventoryWizard.tsx`

Lägg till ett "lista-läge" som toggle i headern:

```typescript
const [viewMode, setViewMode] = useState<'wizard' | 'list'>('wizard');
const [savedItems, setSavedItems] = useState<InventoryItem[]>([]);

// Ladda sparade objekt
useEffect(() => {
  const loadItems = async () => {
    const { data } = await supabase
      .from('assets')
      .select('fm_guid, name, asset_type, ...')
      .eq('is_local', true)
      .order('created_at', { ascending: false })
      .limit(20);
    setSavedItems(data || []);
  };
  loadItems();
}, [savedCount]);

// Header med toggle
<div className="flex items-center gap-2">
  <Button 
    variant={viewMode === 'wizard' ? 'default' : 'outline'}
    size="sm"
    onClick={() => setViewMode('wizard')}
  >
    Ny
  </Button>
  <Button 
    variant={viewMode === 'list' ? 'default' : 'outline'}
    size="sm"
    onClick={() => setViewMode('list')}
  >
    Lista ({savedItems.length})
  </Button>
</div>

// Visa lista eller wizard
{viewMode === 'list' ? (
  <InventoryList 
    items={savedItems} 
    isLoading={isLoading}
    onEdit={(item) => {
      // Sätt editItem och byt till wizard
      setEditItem(item);
      setViewMode('wizard');
    }}
  />
) : (
  // Befintlig wizard-kod
)}
```

**Förväntat resultat:**  
- Användaren kan växla mellan "Ny" (wizard) och "Lista" (sparade objekt)
- Klick på ett objekt i listan öppnar det för redigering

---

## Filer som Påverkas

| Fil | Ändringar |
|-----|-----------|
| `src/components/chat/GunnarButton.tsx` | Minimera-funktion med toggle |
| `src/components/inventory/mobile/MobileInventoryWizard.tsx` | Lista-vy, redigering, position-steg |
| `src/components/inventory/mobile/PositionPickerStep.tsx` | **NY FIL** - 3D/360 position picker för mobil |
| `src/components/inventory/mobile/QuickRegistrationStep.tsx` | Visa valda koordinater |

---

## Flödesöversikt efter Implementering

```text
┌─────────────────────────────────────────────────────────────────┐
│                    GUNNAR CHAT (mobil)                          │
├─────────────────────────────────────────────────────────────────┤
│  [−] Minimera → Liten bubbla i hörnet                          │
│  [+] Expandera → Full panel                                     │
│  → 3D-vy synlig bakom minimerad bubbla                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                MOBIL INVENTERING                                │
├─────────────────────────────────────────────────────────────────┤
│  [Header]  [📍 Ny] [📋 Lista (9)]                               │
│                                                                 │
│  LISTA-VY:                                                      │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🧯 Brandslang        Centralstationen → Plan 2    5 min    ││
│  │ 🧯 Brandfilt         Centralstationen → Plan 1    10 min   ││
│  │ 🧯 Brandsläckare     Centralstationen → Plan 2    1 h      ││
│  │ → Klicka för att redigera                                  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  WIZARD-VY (ny/redigera):                                       │
│  📍 Plats → 🏢 Byggnad/Våning → 📋 Kategori → 📍 Position → ✏️ │
│                                                     ↑           │
│                                            [Välj i 3D]          │
│                                            [Välj i 360°]        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Verifieringssteg

1. **Gunnar minimering:**
   - Öppna Gunnar på mobil
   - Tryck minimera-knappen
   - Verifiera att 3D-vyn syns bakom
   - Klicka på bubblan → panelen expanderas

2. **3D/360 position:**
   - Starta ny inventering på mobil
   - Gå till position-steget
   - Tryck "Välj i 3D" → fullskärms-viewer öppnas
   - Klicka på en yta → position sparas
   - Verifiera att koordinater visas i registreringssteget

3. **Inventeringslista:**
   - Öppna Inventering på mobil
   - Tryck "Lista" i headern
   - Verifiera att sparade objekt visas
   - Klicka på ett objekt → det öppnas för redigering
