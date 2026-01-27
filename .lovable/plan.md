
# Plan: Förbättra BIM-modellnamn och XKT-hämtning

## Sammanfattning

Implementera en robust lösning för att hämta korrekta BIM-modellnamn från Asset+ och optimera XKT-filhämtning för bättre prestanda.

## Del 1: Korrigera BIM-modellnamn-flödet

### Grundorsak
- `xkt_models`-tabellen är tom - XKT-synk har aldrig körts
- Matchningen mellan XEOkit-modell-ID:n och Asset+ modell-ID:n fungerar inte

### Lösning

#### Steg 1: Kör XKT-synk för att populera xkt_models-tabellen

Befintlig `sync-xkt`-action i `asset-plus-sync` sparar redan:
- `model_id` (från Asset+ API)
- `model_name` (t.ex. "A-modell", "E-modell")
- `file_name` (XKT-filnamnet)
- `building_fm_guid`

Detta skapar rätt mappning mellan XKT-filnamn och modellnamn.

#### Steg 2: Förbättra matchningslogik i ModelVisibilitySelector

Uppdatera `extractModels()` för att matcha XEOkit-modeller mot xkt_models:

```typescript
// Nuvarande problem:
// XEOkit scene.models key: "abc123.xkt" eller "abc123"
// Asset+ GetModels id: "xyz789" 
// xkt_models.file_name: "abc123.xkt"
// xkt_models.model_name: "A-modell"

// Lösning: Matcha på file_name istället för model_id
const extractModels = useCallback(() => {
  const viewer = getXeokitViewer();
  if (!viewer?.scene?.models) return [];

  const sceneModels = viewer.scene.models;
  const extractedModels: ModelInfo[] = [];

  Object.entries(sceneModels).forEach(([modelId, model]: [string, any]) => {
    // modelId är typiskt filnamnet från XKT-laddaren
    const fileName = (model.id || modelId).replace(/\.xkt$/i, '') + '.xkt';
    const fileNameWithoutExt = fileName.replace(/\.xkt$/i, '');
    
    // Sök matchning baserat på filnamn
    let matchedName = 
      modelNamesMap.get(fileName) ||
      modelNamesMap.get(fileName.toLowerCase()) ||
      modelNamesMap.get(fileNameWithoutExt) ||
      modelNamesMap.get(fileNameWithoutExt.toLowerCase());
    
    const friendlyName = matchedName || fileNameWithoutExt;
    
    extractedModels.push({
      id: modelId,
      name: friendlyName,
      shortName: friendlyName.length > 25 ? friendlyName.substring(0, 25) + '...' : friendlyName,
    });
  });

  return extractedModels.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}, [getXeokitViewer, modelNamesMap]);
```

#### Steg 3: Uppdatera fetchModelNames för att bygga map korrekt

```typescript
// I fetchModelNames()
if (dbModels && dbModels.length > 0) {
  const nameMap = new Map<string, string>();
  
  dbModels.forEach((m) => {
    // Mappa file_name -> model_name (primär matchning)
    if (m.file_name && m.model_name) {
      nameMap.set(m.file_name, m.model_name);
      nameMap.set(m.file_name.toLowerCase(), m.model_name);
      nameMap.set(m.file_name.replace('.xkt', ''), m.model_name);
      nameMap.set(m.file_name.replace('.xkt', '').toLowerCase(), m.model_name);
    }
  });
  
  setModelNamesMap(nameMap);
}
```

---

## Del 2: Optimera XKT-filhämtning

### Nuvarande problem
XKT-filer hämtas direkt från Asset+ API vid varje sidladdning, vilket:
- Tar lång tid (varje fil kan vara flera MB)
- Belastar Asset+ servern
- Kräver autentisering varje gång

### Lösning: Använd synkade XKT-filer från Supabase Storage

#### Steg 1: Verifiera att XKT-filer är synkade

Kör `sync-xkt` action som laddar ner XKT-filer till Supabase Storage och sparar metadata i `xkt_models`.

#### Steg 2: Uppdatera 3D-viewern att använda cachade filer

Modifiera XKT-laddningslogiken i `AssetPlusViewer.tsx` eller `xkt-cache-service.ts`:

```typescript
// xkt-cache-service.ts - uppdatera checkCache
async checkCache(modelId: string, buildingFmGuid: string): Promise<{cached: boolean, url?: string}> {
  // Försök hitta i xkt_models-tabellen
  const { data: model } = await supabase
    .from('xkt_models')
    .select('file_url, storage_path')
    .eq('building_fm_guid', buildingFmGuid)
    .or(`model_id.eq.${modelId},file_name.eq.${modelId},file_name.eq.${modelId}.xkt`)
    .maybeSingle();
  
  if (model?.file_url) {
    return { cached: true, url: model.file_url };
  }
  
  // Fallback: hämta signerad URL från storage
  if (model?.storage_path) {
    const { data } = await supabase.storage
      .from('xkt-models')
      .createSignedUrl(model.storage_path, 3600);
    
    return { cached: true, url: data?.signedUrl };
  }
  
  return { cached: false };
}
```

---

## Del 3: Optimera våningsplans-prestanda

### Nuvarande problem
`applyFloorVisibility()` itererar över varje objekt individuellt:
```typescript
objectIds.forEach(id => {
  const entity = scene.objects?.[id];
  if (entity) {
    entity.visible = isVisible;
  }
});
```

Med 10,000+ objekt blir detta långsamt och blockerar UI.

### Lösning: Använd XEOkit batch-API

```typescript
const applyFloorVisibility = useCallback((visibleIds: Set<string>) => {
  const viewer = getXeokitViewer();
  if (!viewer?.scene) return;

  const scene = viewer.scene;
  const childrenMap = buildChildrenMap();
  
  // Samla alla objekt-IDs att visa
  const idsToShow: string[] = [];
  
  floors.forEach(floor => {
    if (visibleIds.has(floor.id)) {
      floor.metaObjectIds.forEach(metaObjId => {
        idsToShow.push(...getChildIdsOptimized(metaObjId, childrenMap));
      });
    }
  });
  
  // Batch-uppdatering - mycket snabbare!
  if (scene.setObjectsVisible) {
    // Dölj allt först
    scene.setObjectsVisible(scene.objectIds, false);
    // Visa valda
    scene.setObjectsVisible(idsToShow, true);
  } else {
    // Fallback för äldre XEOkit
    requestIdleCallback(() => {
      const idSet = new Set(idsToShow);
      Object.entries(scene.objects).forEach(([id, entity]: [string, any]) => {
        if (entity) entity.visible = idSet.has(id);
      });
    }, { timeout: 50 });
  }
}, [getXeokitViewer, floors, buildChildrenMap, getChildIdsOptimized]);
```

---

## Del 4: Alternativ - Hämta modellnamn från Asset+ objektdata

### Bakgrund
Varje objekt i Asset+ har `parentBimObjectId` som pekar på BIM-modellen. Vi kan använda detta för att:
1. Extrahera unika BIM-modell-IDs från synkade assets
2. Mappa dessa till modellnamn via GetModels API
3. Spara mappningen i `xkt_models`

### Implementation i sync-funktionen

```typescript
// I asset-plus-sync/index.ts - ny action
if (action === 'sync-bim-models-metadata') {
  // Hämta unika parentBimObjectId från assets
  const { data: bimObjectIds } = await supabase
    .from('assets')
    .select('attributes->parentBimObjectId')
    .eq('building_fm_guid', buildingFmGuid)
    .not('attributes->parentBimObjectId', 'is', null);
  
  // Anropa Asset+ GetModels för att få modellnamn
  // Uppdatera xkt_models med mappning
}
```

---

## Teknisk sammanfattning

### Filer att ändra

| Fil | Ändringar |
|-----|-----------|
| `src/components/viewer/ModelVisibilitySelector.tsx` | Förbättra matchningslogik för filnamn mot modellnamn |
| `src/components/viewer/FloorVisibilitySelector.tsx` | Implementera batch-visibility för bättre prestanda |
| `src/services/xkt-cache-service.ts` | Prioritera databashämtning för XKT-filer |

### Åtgärder att utföra

1. **Kör XKT-synk** via API Settings för att populera `xkt_models`-tabellen
2. **Uppdatera ModelVisibilitySelector** med bättre matchningslogik
3. **Optimera FloorVisibilitySelector** med batch-uppdateringar
4. **Uppdatera xkt-cache-service** att använda databas-först

---

## Förväntade resultat

1. **BIM-modellnamn** visas korrekt som "A-modell", "E-modell" etc.
2. **XKT-filer** laddas från Supabase Storage istället för Asset+ (snabbare)
3. **Våningsfiltrering** blir snabbare med batch-uppdateringar
4. **Matchning** fungerar korrekt mellan XEOkit-modell-IDs och databas

---

## Steg för användaren

1. Gå till API-inställningar
2. Klicka på "Synka" för XKT-filer
3. Vänta tills synkroniseringen är klar
4. Öppna 3D-visaren - modellnamn ska nu visas korrekt
