

# Plan: Åtgärda Saknade Byggnader & Bakgrundsladda Hierarki

## Sammanfattning

Inventerings-wizarden visar bara 8 av 14 byggnader på grund av två problem:

1. **Kategorifiltrering** – inläsningen hämtar bara `Building`, inte `IfcBuilding` (och motsvarande för storeys/spaces)
2. **Långsam laddning** – hierarkin tar 20+ sekunder att ladda (47k+ poster), så wizarden kan öppnas innan data är klar

### Lösning
1. Lägg till `IfcBuilding`, `IfcBuildingStorey`, `IfcSpace` i kategorifilteringen
2. Skapa en tvåstegsladding: först enbart hierarkin (Building/Storey/Space = snabb), sedan tillgångar (Instance) on-demand
3. Bakgrundsladda hierarkin vid app-uppstart

---

## Del 1: Fixa Kategorifiltrering

### Problem
`refreshInitialData` i `AppContext.tsx` anropar:
```typescript
await fetchLocalAssets(['Building', 'Building Storey', 'Space', 'Instance'])
```

Detta missar alternativa IFC-kategorier som kan finnas i databasen.

### Lösning
Lägg till IFC-varianter:

```typescript
await fetchLocalAssets([
    'Building', 'IfcBuilding',
    'Building Storey', 'IfcBuildingStorey', 
    'Space', 'IfcSpace',
    // Instance laddas INTE vid uppstart, utan on-demand
]);
```

**Fil:** `src/context/AppContext.tsx` (rad 464-469)

---

## Del 2: Tvåstegsladdning

### Nuvarande flöde
```
App start → fetchLocalAssets([allt inkl Instance]) → 47k+ poster → 20+ sek
```

### Nytt flöde
```
App start → fetchLocalAssets([Building, Storey, Space]) → ~4k poster → 2-3 sek
                                                         ↓
                                            navigatorTreeData klar
                                                         ↓
                                            Inventory kan visa byggnader
```

Tillgångar (Instance) laddas sedan on-demand när:
- Användaren expanderar ett rum i Navigator
- Användaren öppnar Assets-vy för en byggnad/våning

### Implementation

**Fil:** `src/context/AppContext.tsx`

```typescript
const refreshInitialData = useCallback(async (includeAssets = false) => {
    setIsLoadingData(true);
    try {
        // Steg 1: Ladda hierarki snabbt
        const categories = [
            'Building', 'IfcBuilding',
            'Building Storey', 'IfcBuildingStorey',
            'Space', 'IfcSpace',
        ];
        
        if (includeAssets) {
            categories.push('Instance');
        }
        
        const allObjects = await fetchLocalAssets(categories);
        setAllData(allObjects);
        setNavigatorTreeData(buildNavigatorTree(allObjects));
    } catch (error) {
        console.error('Failed to load assets:', error);
    } finally {
        setIsLoadingData(false);
    }
}, [buildNavigatorTree, setAllData]);
```

---

## Del 3: Fixa `buildNavigatorTree` för IFC-kategorier

### Problem
Rad 281-283 filtrerar bara `Building`, inte `IfcBuilding`:
```typescript
const buildings = items.filter(item => item.category === 'Building');
```

### Lösning
Uppdatera alla filtreringar att inkludera IFC-varianter:

```typescript
const buildings = items.filter(item => 
    item.category === 'Building' || item.category === 'IfcBuilding'
);
const storeys = items.filter(item => 
    item.category === 'Building Storey' || item.category === 'IfcBuildingStorey'
);
const spaces = items.filter(item => 
    item.category === 'Space' || item.category === 'IfcSpace'
);
```

**Fil:** `src/context/AppContext.tsx` (rad 278-284)

---

## Del 4: Lazy Load för Tillgångar

### Ny funktion i `asset-plus-service.ts`

```typescript
/**
 * Fetch assets (Instance) for a specific building on demand.
 */
export async function fetchAssetsForBuilding(buildingFmGuid: string): Promise<any[]> {
    const { data, error } = await supabase
        .from('assets')
        .select('fm_guid, category, name, common_name, ...')
        .eq('building_fm_guid', buildingFmGuid)
        .eq('category', 'Instance');
    
    if (error) throw error;
    return mapToCamelCase(data || []);
}
```

### Användning i Navigator/AssetsView
När användaren expanderar ett rum eller öppnar AssetsView:
```typescript
const assets = await fetchAssetsForBuilding(buildingFmGuid);
// Merge into allData or show directly
```

---

## Del 5: Garanterad laddning vid wizard-öppning

### Problem
`LocationSelectionStep` visar loading-skeleton om `isLoadingData` är true, men om det redan är laddat och listan är tom visas "Ingen data".

### Lösning
Kontrollera att hierarki är laddad innan wizarden öppnas:

**Fil:** `src/pages/Inventory.tsx`

```typescript
const { navigatorTreeData, isLoadingData, refreshInitialData } = useContext(AppContext);

useEffect(() => {
    // Säkerställ att hierarki är laddad
    if (!isLoadingData && navigatorTreeData.length === 0) {
        refreshInitialData();
    }
}, []);
```

---

## Filer som påverkas

| Fil | Ändringar |
|-----|-----------|
| `src/context/AppContext.tsx` | Lägg till IFC-kategorier, tvåstegsladdning |
| `src/services/asset-plus-service.ts` | Ny `fetchAssetsForBuilding()` funktion |
| `src/pages/Inventory.tsx` | Trigga refresh om hierarki saknas |
| `src/components/inventory/mobile/LocationSelectionStep.tsx` | Redan fixad med loading/empty states |

---

## Teknisk sammanfattning

```
┌────────────────────────────────────────────────────────────┐
│                    APP STARTUP                              │
├────────────────────────────────────────────────────────────┤
│  1. refreshInitialData(includeAssets=false)                │
│     └─> Hämtar Building, Storey, Space (~4k poster, ~2s)   │
│  2. navigatorTreeData populeras                            │
│  3. isLoadingData = false                                  │
└────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│               MOBILE INVENTORY WIZARD                       │
├────────────────────────────────────────────────────────────┤
│  • Alla 14 byggnader visas direkt                          │
│  • Alla 87 våningsplan tillgängliga                        │
│  • Rum laddas redan (ingår i Space)                        │
└────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│               ON-DEMAND ASSET LOADING                       │
├────────────────────────────────────────────────────────────┤
│  När användaren:                                           │
│  • Öppnar AssetsView för en byggnad                        │
│  • Expanderar rum i Navigator                              │
│  → fetchAssetsForBuilding(buildingFmGuid)                  │
└────────────────────────────────────────────────────────────┘
```

---

## Förväntat resultat

1. **Snabbare uppstart** – hierarkin laddas på ~2-3 sekunder istället för 20+
2. **Alla byggnader visas** – 14 st istället för 8
3. **Alla våningar visas** – inklusive IFC-varianter
4. **Inventering fungerar direkt** – ingen väntan på tillgångsladdning

