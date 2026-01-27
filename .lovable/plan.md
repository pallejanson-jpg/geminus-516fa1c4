
# Plan: Fixa BIM-modell och våningsplansfiltrering i 3D-viewer

## Sammanfattning

Fyra problem ska åtgärdas:

1. BIM-modellnamn visar tekniska ID:n istället för läsbara namn från Asset+
2. Alla modeller visas som standard (ska endast visa A-modeller)
3. Våningsplan listas med dupliceringar från olika modeller
4. Våningsfiltrering släcker inte allt på andra våningsplan

---

## Del 1: Fixa BIM-modellnamn

**Fil:** `src/components/viewer/ModelVisibilitySelector.tsx`

### Problemanalys

Nuvarande kod försöker matcha `viewer.scene.models[modelId]` mot `model.id` från Asset+ API. Men modelId i viewer kan vara ett XKT-filnamn (t.ex. `755950d9-f235-4d64-a38d-b7fc15a0cad9.xkt`) medan Asset+ API returnerar ett annat format.

### Lösning

1. **Hämta modellnamn från databasen istället för API:** Använd `xkt_models`-tabellen som redan har `model_name` synkat från Asset+, eller alternativt hämta direkt från Asset+ API och matcha på filnamn/modell-ID

2. **Förbättra matchningslogik:** Asset+ GetModels-svaret inkluderar ofta `xktFileUrl` som innehåller filnamnet. Matcha scene model ID mot den sista delen av URL:en

```typescript
// Ny matchningslogik
const extractModelIdFromUrl = (xktFileUrl: string): string => {
  const fileName = xktFileUrl.split('/').pop() || '';
  return fileName.replace('.xkt', '');
};

// I API-anropet, bygg en map från alla möjliga identifierare
apiModels.forEach((m: any) => {
  // Primär: model.id
  if (m.id && m.name) nameMap.set(m.id, m.name);
  // Sekundär: extraherat från xktFileUrl  
  if (m.xktFileUrl && m.name) {
    const fileId = extractModelIdFromUrl(m.xktFileUrl);
    nameMap.set(fileId, m.name);
    // Även med .xkt extension
    nameMap.set(fileId + '.xkt', m.name);
  }
});
```

3. **Sätt endast A-modeller synliga som standard:**

```typescript
// I checkModels(), ändra från allIds till endast A-modeller
const checkModels = () => {
  const newModels = extractModels();
  if (newModels.length > 0) {
    setModels(newModels);
    // Filtrera till endast A-modeller som standard
    const aModelIds = new Set(
      newModels
        .filter(m => m.name.toLowerCase().startsWith('a') || m.name.toLowerCase().includes('a-modell'))
        .map(m => m.id)
    );
    // Om inga A-modeller hittas, visa alla
    setVisibleModelIds(aModelIds.size > 0 ? aModelIds : new Set(newModels.map(m => m.id)));
    // Applicera synligheten direkt
    applyModelVisibility(aModelIds.size > 0 ? aModelIds : new Set(newModels.map(m => m.id)));
    setIsInitialized(true);
  }
};
```

---

## Del 2: Fixa våningsplan - deduplicering och korrekt filtrering

**Fil:** `src/components/viewer/FloorVisibilitySelector.tsx`

### Problemanalys

Varje BIM-modell har sina egna `IfcBuildingStorey`-objekt. "Plan 1" i A-modellen och "Plan 1" i E-modellen är tekniskt två olika metaObjects med olika ID:n. Nuvarande kod:
- Listar varje storey separat (dupliceringar)
- Vid filtrering döljs endast objekt under det specifika storey-objektet, inte alla med samma namn

### Lösning: Gruppera våningar efter namn

```typescript
// Ny FloorInfo-typ som grupperar alla metaObjects med samma namn
export interface FloorInfo {
  id: string;  // Primärt ID (första metaObject)
  name: string;  // Våningsnamn (t.ex. "Plan 1")
  shortName: string;
  metaObjectIds: string[];  // ALLA metaObjects med detta namn (från alla modeller)
  databaseLevelFmGuids: string[];  // Alla fmGuids för denna våning
}

// Ny extractFloors som grupperar
const extractFloors = useCallback(() => {
  const viewer = getXeokitViewer();
  if (!viewer?.metaScene?.metaObjects) return [];

  const metaObjects = viewer.metaScene.metaObjects;
  const floorsByName = new Map<string, FloorInfo>();

  Object.values(metaObjects).forEach((metaObject: any) => {
    const type = metaObject?.type?.toLowerCase();
    if (type === 'ifcbuildingstorey') {
      const name = metaObject.name || 'Unknown Floor';
      const shortMatch = name.match(/(\d+)/);
      const shortName = shortMatch ? shortMatch[1] : name.substring(0, 4);
      
      if (floorsByName.has(name)) {
        // Lägg till detta metaObject till befintlig grupp
        const existing = floorsByName.get(name)!;
        existing.metaObjectIds.push(metaObject.id);
        const fmGuid = metaObject.originalSystemId || metaObject.id;
        if (!existing.databaseLevelFmGuids.includes(fmGuid)) {
          existing.databaseLevelFmGuids.push(fmGuid);
        }
      } else {
        // Skapa ny grupp
        floorsByName.set(name, {
          id: metaObject.id,  // Första ID som representant
          name,
          shortName,
          metaObjectIds: [metaObject.id],
          databaseLevelFmGuids: [metaObject.originalSystemId || metaObject.id],
        });
      }
    }
  });

  // Konvertera till array och sortera
  const extractedFloors = Array.from(floorsByName.values());
  extractedFloors.sort((a, b) => {
    const numA = parseInt(a.shortName) || 0;
    const numB = parseInt(b.shortName) || 0;
    return numA - numB;
  });

  return extractedFloors;
}, [getXeokitViewer]);
```

### Lösning: Uppdatera applyFloorVisibility för grupperad logik

```typescript
const applyFloorVisibility = useCallback((visibleIds: Set<string>) => {
  const viewer = getXeokitViewer();
  if (!viewer?.scene) return;

  const scene = viewer.scene;
  const childrenMap = buildChildrenMap();

  floors.forEach(floor => {
    const isVisible = visibleIds.has(floor.id);
    
    // Iterera genom ALLA metaObjects för denna våning (från alla modeller)
    floor.metaObjectIds.forEach(metaObjId => {
      const objectIds = getChildIdsOptimized(metaObjId, childrenMap);
      objectIds.forEach(id => {
        const entity = scene.objects?.[id];
        if (entity) {
          entity.visible = isVisible;
        }
      });
    });
  });
}, [getXeokitViewer, floors, buildChildrenMap, getChildIdsOptimized]);
```

---

## Del 3: Uppdatera FloorInfo-gränssnittet

**Fil:** `src/components/viewer/FloorVisibilitySelector.tsx`

Befintligt interface behöver uppdateras:

```typescript
// FRÅN:
export interface FloorInfo {
  id: string;
  fmGuid: string;
  name: string;
  shortName: string;
  viewerMetaObjectId: string;
  databaseLevelFmGuid?: string;
}

// TILL:
export interface FloorInfo {
  id: string;  // Representativt ID för gruppen
  name: string;
  shortName: string;
  metaObjectIds: string[];  // Alla metaObject-ID med detta namn
  databaseLevelFmGuids: string[];  // Alla databas-fmGuids
}
```

---

## Del 4: Synkronisera med onVisibleFloorsChange callback

När callback anropas, skicka alla relevanta fmGuids:

```typescript
if (onVisibleFloorsChange) {
  const visibleFloors = floors.filter(f => newSet.has(f.id));
  // Samla alla fmGuids från alla synliga våningar
  const allFmGuids = visibleFloors.flatMap(f => f.databaseLevelFmGuids);
  onVisibleFloorsChange(allFmGuids);
}
```

---

## Sammanfattning av ändringar

| Fil | Ändringar |
|-----|-----------|
| `ModelVisibilitySelector.tsx` | Förbättrad modellnamn-matchning via xktFileUrl, A-modeller synliga som standard |
| `FloorVisibilitySelector.tsx` | Gruppera våningar efter namn, applicera synlighet på alla metaObjects med samma namn |

---

## Teknisk referens

### Asset+ GetModels API-respons (exempel)
```json
[
  {
    "id": "model-guid-123",
    "name": "A-modell",
    "xktFileUrl": "https://.../.../755950d9-f235-4d64-a38d-b7fc15a0cad9.xkt"
  },
  {
    "id": "model-guid-456", 
    "name": "E-modell",
    "xktFileUrl": "https://.../.../abc123-def456.xkt"
  }
]
```

### XEOkit scene.models (exempel)
```javascript
viewer.scene.models = {
  "755950d9-f235-4d64-a38d-b7fc15a0cad9.xkt": { ... },
  "abc123-def456.xkt": { ... }
}
```

Matchning sker genom att extrahera filnamnet från `xktFileUrl` och jämföra med scene model keys.

---

## Förväntade resultat

1. **Modellnamn:** Visas som "A-modell", "E-modell" etc.
2. **Standardsynlighet:** Endast A-modeller synliga vid start
3. **Våningsplan:** Varje unikt våningsnamn listas endast EN gång
4. **Våningsfiltrering:** När "Plan 1" väljs släcks ALLA objekt på andra våningar i alla modeller
