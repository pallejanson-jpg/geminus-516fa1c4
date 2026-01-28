

# Plan: Implementera lokal annotation-rendering i 3D-viewern

## Identifierat problem

Annotationer som skapats via inventeringsformuläret (sparade i `assets`-tabellen med `annotation_placed=true` och koordinater) **visas aldrig i 3D-viewern**.

**Grundorsak:** Det finns ingen kod som skapar xeokit-annotationer baserat på vår lokala databas. Koden:
1. Hämtar kategoridata från databasen
2. Försöker toggla `viewer.annotationsPlugin.annotations` - men den kollektionen är **tom**
3. Skapar aldrig visuella markörer med xeokits `AnnotationsPlugin.createAnnotation()`

Dessutom visas engelska tekniska namn (`fire_blanket`) istället för svenska namn (`Brandfilt`).

**Data i databasen:**
- Asset: `asset_type=fire_blanket`, `symbol_id=e165e79d...`, koordinater (10.5, 20.3, 1.2)
- Symbol: `name=Brandfilt`, `icon_url=.../Brandfilt.png`, `color=#A11D1D`

---

## Lösning

### Del 1: Lägg till `loadLocalAnnotations` i AssetPlusViewer.tsx

Skapa en funktion som:
1. Hämtar alla assets med `annotation_placed=true` för aktuell byggnad
2. Hämtar symboler för att få ikoner och färger
3. Skapar xeokit-annotationer via `AnnotationsPlugin.createAnnotation()` för varje asset
4. Lagrar plugin-instansen i en ref för kategori-filtrering

**Var:** I `AssetPlusViewer.tsx`, anropa funktionen i `handleAllModelsLoaded` efter att modellerna laddats.

**Kod:**
```typescript
// Ny ref för lokalt AnnotationsPlugin
const localAnnotationsPluginRef = useRef<any>(null);

// Funktion för att ladda lokala annotationer
const loadLocalAnnotations = useCallback(async () => {
  const buildingGuid = resolveBuildingFmGuid();
  if (!buildingGuid) return;
  
  const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  if (!xeokitViewer) return;

  // Hämta assets med placerade annotationer
  const { data: assets } = await supabase
    .from('assets')
    .select('fm_guid, name, asset_type, coordinate_x, coordinate_y, coordinate_z, symbol_id')
    .eq('building_fm_guid', buildingGuid)
    .eq('annotation_placed', true)
    .not('coordinate_x', 'is', null);

  // Hämta symboler för ikoner och färger
  const { data: symbols } = await supabase
    .from('annotation_symbols')
    .select('id, name, category, color, icon_url');
  
  const symbolMap = new Map(symbols?.map(s => [s.id, s]) || []);

  // Skapa eller hämta AnnotationsPlugin
  if (!localAnnotationsPluginRef.current) {
    const { AnnotationsPlugin } = await import('@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js');
    localAnnotationsPluginRef.current = new AnnotationsPlugin(xeokitViewer, {
      markerHTML: `<div class="local-annotation-marker" style="...">
        <img src="{{iconUrl}}" ... />
      </div>`,
      labelHTML: `<div class="local-annotation-label" style="...">{{name}}</div>`,
    });
  }
  
  // Rensa befintliga och skapa nya
  localAnnotationsPluginRef.current.clear();
  
  assets?.forEach(asset => {
    const symbol = asset.symbol_id ? symbolMap.get(asset.symbol_id) : null;
    
    localAnnotationsPluginRef.current.createAnnotation({
      id: `local-${asset.fm_guid}`,
      worldPos: [asset.coordinate_x, asset.coordinate_y, asset.coordinate_z],
      markerShown: showAnnotations,
      labelShown: false,
      values: {
        name: asset.name || 'Okänd',
        color: symbol?.color || '#3B82F6',
        iconUrl: symbol?.icon_url || '',
      },
      cfg: {
        category: asset.asset_type,
        assetFmGuid: asset.fm_guid,
      }
    });
  });
  
  console.log(`Created ${assets?.length || 0} local annotations`);
}, [showAnnotations]);
```

**Anropa i `handleAllModelsLoaded`:**
```typescript
// Efter rad 527 (efter NavCube initialisering)
loadLocalAnnotations();
```

**Exponera pluginet till viewerRef för kategorilistan:**
```typescript
// I viewerInstanceRef, lägg till en property:
if (viewerInstanceRef.current) {
  viewerInstanceRef.current.localAnnotationsPlugin = localAnnotationsPluginRef.current;
}
```

---

### Del 2: Fixa AnnotationCategoryList.tsx med svenska namn

**Uppdatera fetchCategories:**
```typescript
// Hämta assets och joina med symbols för svenska namn
const { data: assets } = await supabase
  .from('assets')
  .select('asset_type, symbol_id')
  .eq('building_fm_guid', buildingFmGuid)
  .eq('annotation_placed', true);

const { data: symbols } = await supabase
  .from('annotation_symbols')
  .select('id, name, color');

const symbolById = new Map(symbols?.map(s => [s.id, s]) || []);

// Gruppera och använd symbolens svenska namn
assets?.forEach(asset => {
  const symbol = asset.symbol_id ? symbolById.get(asset.symbol_id) : null;
  const key = asset.asset_type || 'Övrigt';
  
  if (!typeInfo[key]) {
    typeInfo[key] = {
      count: 0,
      displayName: symbol?.name || key,  // Svenska namnet
      color: symbol?.color || '#3B82F6',
    };
  }
  typeInfo[key].count++;
});
```

**Uppdatera interface:**
```typescript
interface AnnotationCategory {
  category: string;       // Intern nyckel (asset_type)
  displayName: string;    // Svenskt namn för UI
  count: number;
  visible: boolean;
  color: string;
}
```

**Visa displayName i UI:**
```typescript
<span className="text-xs">{cat.displayName}</span>  // Istället för cat.category
```

**Uppdatera toggle-logik för att använda lokalt plugin:**
```typescript
const handleToggleCategory = useCallback((category: string) => {
  // Använd localAnnotationsPlugin istället för annotationsPlugin
  const localPlugin = viewerRef.current?.localAnnotationsPlugin;
  if (localPlugin?.annotations) {
    Object.values(localPlugin.annotations).forEach((annotation: any) => {
      if (annotation.cfg?.category === category) {
        annotation.markerShown = newVisible;
      }
    });
  }
}, [viewerRef]);
```

---

## Filändringar

| Fil | Ändring |
|-----|---------|
| `src/components/viewer/AssetPlusViewer.tsx` | Lägg till `localAnnotationsPluginRef`, `loadLocalAnnotations()`, anropa i `handleAllModelsLoaded`, exponera till viewerRef |
| `src/components/viewer/AnnotationCategoryList.tsx` | Lägg till `displayName` i interface, joina med `annotation_symbols` för svenska namn, använd `localAnnotationsPlugin` för toggle |

---

## Visuellt flöde efter implementation

```text
1. Modeller laddas i viewern
2. handleAllModelsLoaded() anropas
3. loadLocalAnnotations() hämtar assets med annotation_placed=true
4. xeokit AnnotationsPlugin skapar visuella markörer vid koordinaterna
5. Markörer visas med rätt ikon och färg från annotation_symbols
6. Användaren öppnar "Visa annotationer" flyout
7. Listan visar svenska namn ("Brandfilt") med rätt antal
8. Toggle på/av fungerar per kategori
```

---

## Förväntade resultat

1. **Annotationer visas i 3D** - Markörer vid sparade koordinater
2. **Rätt ikoner och färger** - Från annotation_symbols tabellen
3. **Svenska namn i listan** - "Brandfilt" istället för "fire_blanket"
4. **Kategorifiltrering fungerar** - Toggle döljer/visar rätt annotationer

