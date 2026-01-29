
# Plan: Visa inventerade assets i Navigator/Portfolio och synka till Asset+

## Sammanfattning

Detta projekt kräver två huvudändringar:
1. **Inkludera inventerade assets** (`is_local=true`, `created_in_model=false`) i Navigator-trädet och Portfolio AssetsView
2. **Implementera synkronisering till Asset+** API för att skriva lokalt skapade assets till det centrala systemet

---

## Del 1: Visa inventerade assets i Navigator och Portfolio

### 1.1 Problem

Lokalt inventerade assets (5 st i databasen) visas **inte** i Navigator-trädet eller AssetsView eftersom:

- `fetchLocalAssets()` filtrerar på `category: ['Building', 'Building Storey', 'Space']` - exkluderar `Instance`
- Navigator-trädet bygger endast upp Building → Storey → Space-hierarkin
- AssetsView hämtar assets separat för en specifik byggnad

### 1.2 Lösning för Navigator

**Ändra AppContext.tsx:**

1. Lägg till `Instance` i kategorifiltret för `fetchLocalAssets()`
2. Uppdatera `buildNavigatorTree()` för att hantera Instance-objekt som barn till Spaces

```text
Building
├── Building Storey
│   ├── Space (Rum)
│   │   ├── Instance (Synkad asset från Asset+)
│   │   ├── Instance (Lokal inventerad asset) [med "Ej i modell"-ikon]
│   │   └── Instance (Lokal inventerad asset)
│   └── Space
```

**Uppdatera TreeNode.tsx:**
- Visa redan "Ej i modell"-ikon (AlertCircle) för `createdInModel === false`
- Lägg till actions för Instance-noder (3D-vy, Edit, Sync-status)

### 1.3 Lösning för Portfolio AssetsView

AssetsView hämtar redan alla assets för en byggnad via direkt databasquery:

```typescript
// Nuvarande - från props.assets som kommer från FacilityLandingPage
const { data } = await supabase
  .from('assets')
  .select('*')
  .eq('building_fm_guid', buildingFmGuid)
  .eq('category', 'Instance');
```

**Verifiera:** Kontrollera att AssetsView faktiskt inkluderar `is_local=true` assets (bör redan göra det).

**Lägg till kolumn/filter:**
- Ny kolumn: "Synkad" (visar om asset är synkad till Asset+)
- Filter: "Ej synkade" för att se lokala assets som väntar på synk

---

## Del 2: Synka till Asset+ API

### 2.1 Asset+ API-krav

Baserat på befintlig kod i `asset-plus-create/index.ts`:

**Obligatoriska fält för ObjectType 4 (Instance):**

| Fält | Beskrivning | Källa i Lovable |
|------|-------------|-----------------|
| `objectType` | `4` (Instance) | Hårdkodat |
| `designation` | Primärt namn/nummer | `assets.name` |
| `inRoomFmGuid` | Länk till förälder-Space | `assets.in_room_fm_guid` |

**Valfria fält:**

| Fält | Datatyp | Källa i Lovable |
|------|---------|-----------------|
| `fmGuid` | UUID (128-bit) | `assets.fm_guid` |
| `commonName` | String | `assets.common_name` |
| `properties` | Array | Se nedan |

**Properties-array (användardefinierade egenskaper):**

```typescript
properties: [
  { name: "Description", value: "...", dataType: 0 }, // String
  { name: "InventoryDate", value: "2026-01-28T12:00:00Z", dataType: 4 }, // DateTime
  { name: "AssetCategory", value: "fire_extinguisher", dataType: 0 }, // String
]
```

**DataType-enum:**
- 0 = String
- 1 = Int32
- 2 = Int64
- 3 = Decimal
- 4 = DateTime
- 5 = Bool

### 2.2 Egenskaper som INTE synkas till Asset+

Dessa Lovable-specifika fält finns endast lokalt:

| Lovable-fält | Anledning |
|--------------|-----------|
| `symbol_id` | Lokal annotation-styling |
| `annotation_placed` | Lokal 3D-markör-status |
| `coordinate_x/y/z` | Lovable-specifik 3D-position |
| `ivion_poi_id` | Ivion-integration |
| `is_local` | Synk-tracking |
| `created_in_model` | Lokal status |

### 2.3 Synk-flöde

```text
┌─────────────────────────────────────────────────────────────┐
│                    Synk-process                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Användare klickar "Synka till Asset+"                   │
│     └─> Ikon på asset-rad i AssetsView                      │
│     └─> Eller "Synka alla osykade" knapp                    │
│                                                             │
│  2. Frontend anropar edge function                          │
│     └─> supabase.functions.invoke('asset-plus-create')      │
│                                                             │
│  3. Edge function:                                          │
│     a) Hämtar Keycloak access token                         │
│     b) Bygger BimObject payload                             │
│     c) POST till Asset+ /AddObject                          │
│     d) Vid success: uppdaterar lokal databas                │
│        └─> is_local = false                                 │
│        └─> synced_at = now()                                │
│                                                             │
│  4. UI uppdateras                                           │
│     └─> "Ej synkad" badge försvinner                        │
│     └─> Asset visas som synkad                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.4 Validering före synk

Asset+ kräver `inRoomFmGuid` - assets utan koppling till ett rum kan inte synkas:

```typescript
// Validera innan synk
if (!asset.in_room_fm_guid) {
  throw new Error('Asset måste vara kopplad till ett rum för att synkas till Asset+');
}
```

---

## Tekniska ändringar

### Fil 1: `src/context/AppContext.tsx`

**Ändring:** Inkludera `Instance` i kategorifilter och bygg ut trädet

```typescript
// Rad 441-445: Lägg till 'Instance' i filter
const allObjects = await fetchLocalAssets([
  'Building',
  'Building Storey',
  'Space',
  'Instance', // <-- NYTT
]);

// Uppdatera buildNavigatorTree() för att hantera Instance
// (ny sektion efter space-hantering)
```

### Fil 2: `src/services/asset-plus-service.ts`

**Lägg till:** `fetchLocalAssets()` ska inkludera fler kolumner

```typescript
// Lägg till: is_local, created_in_model, asset_type, synced_at
.select("fm_guid, category, name, common_name, ..., is_local, created_in_model, asset_type, synced_at")
```

**Lägg till:** Ny funktion för att synka enskild asset

```typescript
export async function syncAssetToAssetPlus(assetFmGuid: string): Promise<{success: boolean; error?: string}> {
  // 1. Hämta asset från lokal DB
  // 2. Validera (måste ha in_room_fm_guid)
  // 3. Anropa asset-plus-create edge function
  // 4. Uppdatera lokal status vid success
}
```

### Fil 3: `src/components/navigator/TreeNode.tsx`

**Lägg till:** Actions för Instance-noder

```typescript
// canSyncToAssetPlus = Instance && is_local && has in_room_fm_guid
// Visa sync-ikon för osykade assets
```

### Fil 4: `src/components/portfolio/AssetsView.tsx`

**Lägg till:**
- Ny kolumn: `syncStatus` (Synkad / Ej synkad)
- Ny åtgärd: "Synka till Asset+" knapp
- Batch-synk knapp i toolbar

### Fil 5: `supabase/functions/asset-plus-create/index.ts`

**Uppdatera:** Hantera synk av befintliga lokala assets (inte bara nya)

```typescript
// Lägg till stöd för att hämta asset från DB om endast fmGuid skickas
// Bygg payload från DB-data istället för request body
```

---

## Mappning: Lovable → Asset+

```text
┌────────────────────────────────────────────────────────────────┐
│  Lovable (assets tabell)    →    Asset+ (AddObject)           │
├────────────────────────────────────────────────────────────────┤
│  fm_guid                    →    fmGuid                       │
│  name                       →    designation                  │
│  common_name                →    commonName                   │
│  in_room_fm_guid            →    inRoomFmGuid (OBLIGATORISK)  │
│  (hårdkodat: 4)             →    objectType                   │
│                                                               │
│  attributes.description     →    properties[{name:"Description", │
│                                    value:..., dataType:0}]    │
│  attributes.inventoryDate   →    properties[{name:"InventoryDate",│
│                                    value:..., dataType:4}]    │
│  asset_type                 →    properties[{name:"AssetCategory",│
│                                    value:..., dataType:0}]    │
│                                                               │
│  --- EJ SYNKADE (Lovable-specifika) ---                       │
│  symbol_id                  →    (endast lokal)               │
│  annotation_placed          →    (endast lokal)               │
│  coordinate_x/y/z           →    (endast lokal)               │
│  is_local                   →    (synk-tracking)              │
│  created_in_model           →    (endast lokal)               │
└────────────────────────────────────────────────────────────────┘
```

---

## UI-ändringar

### Navigator-träd (efter implementation)

```text
🏢 Kungsgatan 12
  ├─ 📐 Plan 1
  │    ├─ 🚪 Entré
  │    │    ├─ 🔧 Sensor-001 (synkad)
  │    │    └─ 🧯 Brandsläckare-A ⚠️ [Ej synkad]
  │    └─ 🚪 Kontor A
  └─ 📐 Plan 2
```

### AssetsView med synk-status

| Beteckning | Namn | I modell | Synkad | Åtgärder |
|------------|------|----------|--------|----------|
| BS-001 | Brandsläckare | Nej ⚠️ | Nej 🔄 | [3D] [Synka] |
| Sensor-1 | Temperatursensor | Ja ✓ | Ja ✓ | [3D] |

---

## Förväntade resultat

1. **Navigator visar alla assets** - inkl. lokalt skapade under respektive rum
2. **AssetsView visar synk-status** - tydligt vilka som väntar på synk
3. **Synka till Asset+** - knapp för att pusha lokala assets till centralt system
4. **Batch-synk** - möjlighet att synka alla osykade assets samtidigt
5. **Validering** - assets utan rum-koppling kan inte synkas (tydligt felmeddelande)
