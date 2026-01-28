
# Plan: Mobil Inventeringsfunktion

## Sammanfattning

Skapa en ny mobilvänlig "Inventering"-funktion som låter användare gå runt i en byggnad och enkelt registrera tillgångar (assets). Formuläret sparar direkt till Supabase `assets`-tabellen med `created_in_model = false`.

## Funktionsöversikt

### Användarflöde:
1. Användaren öppnar appen på mobilen
2. Väljer "Inventering" i navigationsmenyn
3. Får upp ett snyggt, mobilvänligt formulär
4. Fyller i grundläggande egenskaper via dropdowns och fritext
5. Klickar "Spara" → data sparas till `assets`-tabellen

### Nyckelprinciper:
- **Mobil-först**: Stora touch-vänliga knappar och inputs
- **Enkelt**: Minimalt antal fält, alla viktiga har dropdowns
- **Snabbt**: Spara direkt till databasen, ingen 3D-vy behövs
- **`created_in_model = false`**: Alla inventerade objekt markeras automatiskt som EJ modellerade

## Formulärfält

| Fält | Typ | Obligatoriskt | Källa |
|------|-----|---------------|-------|
| Namn/Beteckning | Fritext | Ja | `name` |
| Beskrivning | Textarea | Nej | `attributes.description` |
| Kategori | Dropdown | Ja | `asset_type` |
| Symbol | Dropdown med bilder | Ja | `symbol_id` |
| Byggnad | Dropdown | Ja | `building_fm_guid` |
| Våningsplan | Dropdown (filtreras) | Nej | `level_fm_guid` |
| Rum | Dropdown (filtreras) | Nej | `in_room_fm_guid` |

### Kategori-dropdown (asset_type)
Svenska kategorier som mappar till engelska värden:
```typescript
const INVENTORY_CATEGORIES = [
  { value: 'fire_extinguisher', label: 'Brandsläckare', icon: '🔥' },
  { value: 'fire_blanket', label: 'Brandfilt', icon: '🧯' },
  { value: 'fire_hose', label: 'Brandslang', icon: '🚒' },
  { value: 'emergency_exit', label: 'Nödutgång', icon: '🚪' },
  { value: 'sensor', label: 'Sensor', icon: '📡' },
  { value: 'sprinkler', label: 'Sprinkler', icon: '💧' },
  { value: 'hvac_unit', label: 'Luftbehandlingsaggregat', icon: '🌀' },
  { value: 'lamp', label: 'Lampa', icon: '💡' },
  { value: 'furniture', label: 'Möbel', icon: '🪑' },
  { value: 'it_equipment', label: 'IT-utrustning', icon: '💻' },
  { value: 'other', label: 'Övrigt', icon: '📦' },
];
```

### Symbol-dropdown
Hämtas dynamiskt från `annotation_symbols`-tabellen:
- Visar ikon/färg + namn
- Grupperas efter kategori (Fire, Sensor, etc.)

## Teknisk Implementation

### 1. Ny sida: `src/pages/Inventory.tsx`

Huvudkomponent för inventeringsvyn:

```typescript
// Mobil-optimerad layout
export default function Inventory() {
  const { navigatorTreeData } = useContext(AppContext);
  const isMobile = useIsMobile();
  
  // State för aktiv inventering
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [savedItems, setSavedItems] = useState<any[]>([]);
  
  return (
    <div className="h-full flex flex-col p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Inventering</h1>
        <Badge>{savedItems.length} sparade</Badge>
      </div>
      
      {/* Stor "Ny tillgång" knapp */}
      <Button 
        size="lg" 
        className="w-full h-16 text-lg gap-3"
        onClick={() => setIsFormOpen(true)}
      >
        <Plus className="h-6 w-6" />
        Ny tillgång
      </Button>
      
      {/* Lista över senast registrerade */}
      <RecentInventoryList items={savedItems} />
      
      {/* Formulär som drawer/sheet på mobil */}
      <InventoryFormSheet 
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSaved={(item) => {
          setSavedItems(prev => [item, ...prev]);
          setIsFormOpen(false);
        }}
      />
    </div>
  );
}
```

### 2. Formulärkomponent: `src/components/inventory/InventoryForm.tsx`

```typescript
interface InventoryFormProps {
  onSaved: (item: any) => void;
  onCancel: () => void;
}

function InventoryForm({ onSaved, onCancel }: InventoryFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [symbols, setSymbols] = useState<AnnotationSymbol[]>([]);
  
  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [symbolId, setSymbolId] = useState('');
  const [buildingFmGuid, setBuildingFmGuid] = useState('');
  const [levelFmGuid, setLevelFmGuid] = useState('');
  const [roomFmGuid, setRoomFmGuid] = useState('');
  
  // Hämta symboler vid mount
  useEffect(() => {
    supabase
      .from('annotation_symbols')
      .select('*')
      .order('category, name')
      .then(({ data }) => setSymbols(data || []));
  }, []);
  
  const handleSubmit = async () => {
    // Validering
    if (!name.trim()) {
      toast.error('Namn är obligatoriskt');
      return;
    }
    if (!category) {
      toast.error('Välj en kategori');
      return;
    }
    if (!symbolId) {
      toast.error('Välj en symbol');
      return;
    }
    
    setIsLoading(true);
    
    try {
      const newAsset = {
        fm_guid: crypto.randomUUID(),
        name: name.trim(),
        common_name: name.trim(),
        category: 'Instance', // Alltid Instance för inventerade objekt
        asset_type: category,
        symbol_id: symbolId,
        building_fm_guid: buildingFmGuid || null,
        level_fm_guid: levelFmGuid || null,
        in_room_fm_guid: roomFmGuid || null,
        created_in_model: false, // ALLTID false för inventering
        is_local: true,
        annotation_placed: false,
        attributes: {
          description: description.trim() || null,
          inventoryDate: new Date().toISOString(),
        },
      };
      
      const { error } = await supabase
        .from('assets')
        .insert(newAsset);
      
      if (error) throw error;
      
      toast.success('Tillgång sparad!');
      onSaved(newAsset);
    } catch (error) {
      toast.error('Kunde inte spara', {
        description: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
      {/* Namn - stort input */}
      <div className="space-y-2">
        <Label className="text-base">Namn / Beteckning *</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="t.ex. Brandsläckare BS-001"
          className="h-12 text-base"
          autoFocus
        />
      </div>
      
      {/* Kategori dropdown */}
      <div className="space-y-2">
        <Label className="text-base">Kategori *</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-12">
            <SelectValue placeholder="Välj kategori..." />
          </SelectTrigger>
          <SelectContent className="bg-card">
            {INVENTORY_CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                <span className="flex items-center gap-2">
                  <span>{cat.icon}</span>
                  <span>{cat.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      {/* Symbol dropdown med bilder */}
      <div className="space-y-2">
        <Label className="text-base">Symbol *</Label>
        <Select value={symbolId} onValueChange={setSymbolId}>
          <SelectTrigger className="h-12">
            <SelectValue placeholder="Välj symbol..." />
          </SelectTrigger>
          <SelectContent className="bg-card">
            {symbols.map((sym) => (
              <SelectItem key={sym.id} value={sym.id}>
                <span className="flex items-center gap-2">
                  {sym.icon_url ? (
                    <img src={sym.icon_url} alt="" className="w-5 h-5" />
                  ) : (
                    <div 
                      className="w-5 h-5 rounded-full" 
                      style={{ backgroundColor: sym.color }} 
                    />
                  )}
                  <span>{sym.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      {/* Byggnad dropdown */}
      <BuildingSelector 
        value={buildingFmGuid}
        onChange={(v) => {
          setBuildingFmGuid(v);
          setLevelFmGuid('');
          setRoomFmGuid('');
        }}
      />
      
      {/* Våningsplan - filtreras efter byggnad */}
      {buildingFmGuid && (
        <FloorSelector
          buildingFmGuid={buildingFmGuid}
          value={levelFmGuid}
          onChange={(v) => {
            setLevelFmGuid(v);
            setRoomFmGuid('');
          }}
        />
      )}
      
      {/* Rum - filtreras efter våningsplan */}
      {levelFmGuid && (
        <RoomSelector
          levelFmGuid={levelFmGuid}
          value={roomFmGuid}
          onChange={setRoomFmGuid}
        />
      )}
      
      {/* Beskrivning - expanderbar */}
      <div className="space-y-2">
        <Label className="text-base">Beskrivning (valfritt)</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Fritext beskrivning..."
          className="min-h-[80px]"
        />
      </div>
      
      {/* Knappar */}
      <div className="flex gap-3 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="flex-1 h-12"
          disabled={isLoading}
        >
          Avbryt
        </Button>
        <Button
          type="submit"
          className="flex-1 h-12"
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            'Spara'
          )}
        </Button>
      </div>
    </form>
  );
}
```

### 3. Navigeringsintegration

**MobileNav.tsx** - Lägg till Inventering-knapp:
```typescript
<AppButton 
  onClick={() => handleAppClick('inventory')} 
  variant="ghost" 
  className={`flex-col !h-auto !w-auto !p-2 ${activeApp === 'inventory' ? 'text-primary' : t.textSec}`}
>
  <ClipboardList size={22} />
  <span className="text-[10px] mt-1">Inventering</span>
</AppButton>
```

**MainContent.tsx** - Lägg till case:
```typescript
case 'inventory':
  return (
    <Suspense fallback={<Loader2 />}>
      <Inventory />
    </Suspense>
  );
```

### 4. Hjälpkomponenter

**BuildingSelector** - Hämtar byggnader från navigatorTreeData:
```typescript
function BuildingSelector({ value, onChange }) {
  const { navigatorTreeData } = useContext(AppContext);
  const buildings = navigatorTreeData; // Top level = buildings
  
  return (
    <div className="space-y-2">
      <Label className="text-base">Byggnad</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-12">
          <SelectValue placeholder="Välj byggnad..." />
        </SelectTrigger>
        <SelectContent className="bg-card">
          {buildings.map((b) => (
            <SelectItem key={b.fmGuid} value={b.fmGuid}>
              {b.commonName || b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

**FloorSelector** - Filtrerar våningar efter byggnad:
```typescript
function FloorSelector({ buildingFmGuid, value, onChange }) {
  const { navigatorTreeData } = useContext(AppContext);
  const building = navigatorTreeData.find(b => b.fmGuid === buildingFmGuid);
  const floors = building?.children?.filter(c => c.category === 'Building Storey') || [];
  
  return (
    <div className="space-y-2">
      <Label className="text-base">Våningsplan</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-12">
          <SelectValue placeholder="Välj våning..." />
        </SelectTrigger>
        <SelectContent className="bg-card">
          {floors.map((f) => (
            <SelectItem key={f.fmGuid} value={f.fmGuid}>
              {f.commonName || f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

## Databaskolumner som används

Befintliga kolumner i `assets`-tabellen:

| Kolumn | Typ | Värde |
|--------|-----|-------|
| `fm_guid` | text | Genererat UUID |
| `name` | text | Användarinput |
| `common_name` | text | Samma som name |
| `category` | text | `'Instance'` |
| `asset_type` | text | Vald kategori |
| `symbol_id` | uuid | Vald symbol |
| `building_fm_guid` | text | Vald byggnad |
| `level_fm_guid` | text | Valt våningsplan |
| `in_room_fm_guid` | text | Valt rum |
| `created_in_model` | boolean | `false` (ALLTID) |
| `is_local` | boolean | `true` |
| `annotation_placed` | boolean | `false` |
| `attributes` | jsonb | `{ description, inventoryDate }` |

## Filändringar

| Fil | Ändring |
|-----|---------|
| `src/pages/Inventory.tsx` | **NY** - Huvudsida för inventering |
| `src/components/inventory/InventoryForm.tsx` | **NY** - Formulärkomponent |
| `src/components/inventory/InventoryList.tsx` | **NY** - Lista över registrerade objekt |
| `src/components/inventory/selectors/BuildingSelector.tsx` | **NY** - Byggnad-dropdown |
| `src/components/inventory/selectors/FloorSelector.tsx` | **NY** - Våningsplan-dropdown |
| `src/components/inventory/selectors/RoomSelector.tsx` | **NY** - Rum-dropdown |
| `src/components/layout/MobileNav.tsx` | Lägg till Inventering-knapp |
| `src/components/layout/MainContent.tsx` | Lägg till `'inventory'` case |

## Visuell Design

```text
┌─────────────────────────────────────┐
│  ← Inventering          📋 5 sparade │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────────┐│
│  │     ➕ Ny tillgång              ││
│  │     Stor touch-vänlig knapp    ││
│  └─────────────────────────────────┘│
│                                     │
│  Senast registrerade:               │
│  ┌──────────────────────────────┐  │
│  │ 🔥 Brandsläckare BS-001      │  │
│  │    Plan 2, Rum 201           │  │
│  │    Just nu                   │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ 💧 Sprinkler SP-045          │  │
│  │    Plan 1, Korridor          │  │
│  │    2 min sedan               │  │
│  └──────────────────────────────┘  │
│                                     │
└─────────────────────────────────────┘
```

## Förväntade Resultat

- Mobilvänlig inventering utan 3D-vy
- Snabb registrering med dropdowns
- Alla objekt sparas med `created_in_model = false`
- Symbol-val med ikoner/färger från databasen
- Hierarkisk filtrering: Byggnad → Våning → Rum
- Data sparas direkt till Supabase `assets`-tabellen
