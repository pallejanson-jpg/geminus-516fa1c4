
# Plan: Fixa BIM-modellnamn och våningsplansfrysning

## Sammanfattning

1. **BIM-modellnamn**: Hämta riktiga modellnamn från Asset+ API (GetModels) istället för att parsa filnamn
2. **Våningsplansfrysning**: Blockera våningsväljaren tills modellen är fullt laddad och visa "Laddar..." placeholder

---

## Del 1: Hämta korrekta modellnamn från Asset+

**Fil:** `src/components/viewer/ModelVisibilitySelector.tsx`

### Problem
Nuvarande kod (rad 50-59):
```typescript
Object.entries(sceneModels).forEach(([modelId, model]: [string, any]) => {
  const name = model.id || modelId;
  const shortName = name.replace(/\.xkt$/i, '').replace(/-/g, ' ');
  // Resultat: tekniska namn som "755950d9 f235 4d64 a38d b7fc15a0cad9"
});
```

### Lösning
1. Lägg till API-anrop till Asset+ `GetModels` endpoint
2. Matcha `modelId` från scenen mot `model.id` från API:et
3. Använd `model.name` som visningsnamn (t.ex. "A-modell", "E-modell")

### Ny logik

```typescript
// Ny state för API-hämtade namn
const [modelNamesMap, setModelNamesMap] = useState<Map<string, string>>(new Map());

// Hämta modellnamn från Asset+ vid mount
useEffect(() => {
  const fetchModelNames = async () => {
    try {
      const [tokenResult, configResult] = await Promise.all([
        supabase.functions.invoke('asset-plus-query', { body: { action: 'getToken' } }),
        supabase.functions.invoke('asset-plus-query', { body: { action: 'getConfig' } })
      ]);
      
      const accessToken = tokenResult.data?.accessToken;
      const apiUrl = configResult.data?.apiUrl;
      const apiKey = configResult.data?.apiKey;
      
      if (!accessToken || !apiUrl) return;
      
      // Hämta modeller för byggnaden
      const baseUrl = apiUrl.replace(/\/api\/v\d+\/AssetDB\/?$/i, '').replace(/\/+$/, '');
      const response = await fetch(
        `${baseUrl}/api/threed/GetModels?fmGuid=${buildingFmGuid}&apiKey=${apiKey}`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      
      if (response.ok) {
        const models = await response.json();
        const nameMap = new Map();
        models.forEach((m: any) => {
          // Mappa modelId -> name (t.ex. "A-modell")
          nameMap.set(m.id, m.name || m.id);
        });
        setModelNamesMap(nameMap);
      }
    } catch (e) {
      console.debug("Failed to fetch model names:", e);
    }
  };
  
  fetchModelNames();
}, [buildingFmGuid]);

// I extractModels, använd namn från API:et
const friendlyName = modelNamesMap.get(modelId) || name;
```

### Props-ändring
Lägg till `buildingFmGuid` prop för att kunna anropa rätt API:

```typescript
interface ModelVisibilitySelectorProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid: string;  // NY
  onVisibleModelsChange?: (visibleModelIds: string[]) => void;
  className?: string;
}
```

---

## Del 2: Blockera våningsväljare tills modell är laddad

**Fil:** `src/components/viewer/FloorVisibilitySelector.tsx`

### Problem
Den rekursiva `getChildIds` funktionen (rad 124-132) itererar genom alla metaObjects för varje våning. Med tusentals objekt blir detta extremt långsamt.

```typescript
// PROBLEMATISK KOD - O(n*m) komplexitet
const getChildIds = (metaObj: any): string[] => {
  const ids: string[] = [metaObj.id];
  const children = Object.values(metaObjects).filter(
    (m: any) => m.parent?.id === metaObj.id  // Skannar ALLA objekt
  );
  children.forEach((child: any) => {
    ids.push(...getChildIds(child));  // Rekursivt för varje barn
  });
  return ids;
};
```

### Lösning

1. **Lägg till "isViewerReady" prop** - Blockera komponentens rendering tills modellen är laddad
2. **Visa placeholder** - "Laddar våningar..." medan modellen laddas
3. **Lazy-beräkning** - Beräkna endast child IDs när användaren faktiskt expanderar och togglar

### Props-ändring

```typescript
interface FloorVisibilitySelectorProps {
  viewerRef: React.MutableRefObject<any>;
  isViewerReady?: boolean;  // NY - blockera tills true
  onVisibleFloorsChange?: (visibleFloorIds: string[]) => void;
  className?: string;
}
```

### Ny UI-logik

```typescript
// Om viewer inte är redo, visa placeholder
if (!isViewerReady) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
        <Label className="text-xs text-muted-foreground uppercase tracking-wider">
          Våningsplan
        </Label>
        <span className="text-xs text-muted-foreground ml-1 italic">
          (Laddar...)
        </span>
      </div>
    </div>
  );
}
```

### Optimering av applyFloorVisibility

```typescript
// OPTIMERAD - Förbered en parent-to-children map en gång
const buildChildrenMap = useCallback(() => {
  const viewer = getXeokitViewer();
  if (!viewer?.metaScene?.metaObjects) return new Map();
  
  const metaObjects = viewer.metaScene.metaObjects;
  const childrenMap = new Map<string, string[]>();
  
  // En genomgång av alla objekt
  Object.values(metaObjects).forEach((metaObj: any) => {
    const parentId = metaObj.parent?.id;
    if (parentId) {
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(metaObj.id);
    }
  });
  
  return childrenMap;
}, [getXeokitViewer]);

// Använd cached map istället för att skanna alla objekt varje gång
const getChildIds = (metaObjId: string, childrenMap: Map<string, string[]>): string[] => {
  const ids: string[] = [metaObjId];
  const children = childrenMap.get(metaObjId) || [];
  children.forEach(childId => {
    ids.push(...getChildIds(childId, childrenMap));
  });
  return ids;
};
```

---

## Del 3: Uppdatera AssetPlusViewer och VisualizationToolbar

**Fil:** `src/components/viewer/AssetPlusViewer.tsx`

### Ändringar
1. Exponera `isViewerReady` state till child-komponenter
2. Skicka `buildingFmGuid` till `ModelVisibilitySelector`

```typescript
// I AssetPlusViewer
const isViewerReady = modelLoadState === 'loaded' && initStep === 'ready';

// I VisualizationToolbar props
<VisualizationToolbar
  viewerRef={viewerInstanceRef}
  buildingFmGuid={buildingFmGuid}
  isViewerReady={isViewerReady}
  ...
/>
```

**Fil:** `src/components/viewer/VisualizationToolbar.tsx`

### Ändringar
Skicka nya props vidare till child-komponenter:

```typescript
interface VisualizationToolbarProps {
  ...
  buildingFmGuid?: string;  // NY
  isViewerReady?: boolean;  // NY
}

// I komponenten
<ModelVisibilitySelector
  viewerRef={viewerRef}
  buildingFmGuid={buildingFmGuid || ''}
/>

<FloorVisibilitySelector
  viewerRef={viewerRef}
  isViewerReady={isViewerReady}
  onVisibleFloorsChange={handleVisibleFloorsChange}
/>
```

---

## Sammanfattning av ändringar

| Fil | Ändringar |
|-----|-----------|
| `ModelVisibilitySelector.tsx` | Lägg till API-anrop för modellnamn, ny prop `buildingFmGuid` |
| `FloorVisibilitySelector.tsx` | Ny prop `isViewerReady`, placeholder vid laddning, optimerad child-beräkning |
| `VisualizationToolbar.tsx` | Nya props `buildingFmGuid`, `isViewerReady` som skickas vidare |
| `AssetPlusViewer.tsx` | Exponera `isViewerReady`, skicka `buildingFmGuid` till toolbar |

---

## Förväntade resultat

1. **Modellnamn**: Visas som "A-modell", "E-modell" etc. istället för GUID-baserade namn
2. **Ingen frysning**: Våningsväljaren visar "Laddar..." tills modellen är redo
3. **Snabbare toggle**: Optimerad beräkning när användaren togglar våningar
