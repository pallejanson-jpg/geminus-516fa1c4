
# Plan: 3D Viewer-förbättringar - Startproblem, Dubbla Spinners, Modellnamn och Träd

## Översikt

Denna plan åtgärdar fem identifierade problem med 3D-viewern:

1. **Ibland kommer inte Byggnader/Sparade Vyer upp** - användaren kastas direkt in i viewern
2. **Två spinners vid öppning** - behöver stänga av den orangea (eller lila)
3. **Felaktigt modellnamn** - visar "myModel undefined" istället för "A-model"
4. **Saknade modeller i listan** - B-modell, E-modell, V-modell visas inte
5. **Modellträd fungerar dåligt** - selektion/avselektion propagerar inte korrekt
6. **Prestanda-diskussion** - partiell laddning av objekt

---

## Problem 1: Byggnadsväljaren visas inte

### Rotorsak
I `src/pages/Viewer.tsx` (rad 14-20) kontrolleras `viewer3dFmGuid` för att avgöra om BuildingSelector eller AssetPlusViewer ska visas:

```tsx
if (viewer3dFmGuid) {
  return <AssetPlusViewer fmGuid={viewer3dFmGuid} ... />
}
return <BuildingSelector />
```

Om `viewer3dFmGuid` inte återställs korrekt vid föregående session eller av andra skäl har ett gammalt värde, hoppar användaren direkt in i viewern.

### Lösning
Lägg till en `useEffect` som rensar `viewer3dFmGuid` vid unmount av Viewer-komponenten, samt validerar att den valda byggnaden faktiskt existerar i `allData`.

**Fil: `src/pages/Viewer.tsx`**

```tsx
// Add validation that selected building exists
const validBuilding = allData.find(
  (item: any) => item.fmGuid === viewer3dFmGuid && item.category === 'Building'
);

// If GUID is set but building doesn't exist (data not loaded), show selector
if (viewer3dFmGuid && !isLoadingData && !validBuilding) {
  return <BuildingSelector />;
}
```

---

## Problem 2: Två spinners - stänga av den orangea

### Rotorsak
Den **lila** spinnern kommer från React-komponenten `<Spinner />` i `AssetPlusViewer.tsx` (rad 2494-2502).

Den **orangea** spinnern kommer från Asset+ bibliotekets interna DevExtreme `dx-loadindicator` med färgen `#ff5722` definierad i `public/lib/assetplus/assetplusviewer.css` (rad 528-532).

### Lösning
Lägg till CSS-override i `src/index.css` för att dölja den interna Asset+ loadern:

**Fil: `src/index.css`**

```css
/* Dölj Asset+ interna orange spinner för att undvika dubbla indikatorer */
.dx-loadindicator {
  display: none !important;
}

.dx-loadpanel-content,
.dx-loadpanel-wrapper {
  display: none !important;
  visibility: hidden !important;
}
```

---

## Problem 3: Felaktigt modellnamn ("myModel undefined")

### Rotorsak
I `ModelVisibilitySelector.tsx` hämtas modellnamn från `xkt_models` databastabellen eller Asset+ API. Problemet uppstår när:
1. `modelNamesMap` är tom under initialiseringen
2. Det finns en timing-mismatch mellan när modeller laddas i xeokit och när API-namn hämtas
3. Fallback-logiken (rad 242) visar raw model ID om ingen match hittas

### Lösning
1. **Vänta på modellnamn innan modellista visas** - Lägg till explicit beroende på `modelNamesMap.size > 0`
2. **Förbättra fallback-namnet** - Om ingen match, visa "Laddar..." istället av raw ID under hämtning
3. **Uppdatera listan när namn laddas** - Säkerställ att `extractModels` anropas igen efter att `modelNamesMap` fyllts

**Fil: `src/components/viewer/ModelVisibilitySelector.tsx`**

```tsx
// Rad 200-250: Förbättra extractModels med bättre fallback
const extractModels = useCallback(() => {
  // ... existing code ...
  
  // Förbättrad fallback som respekterar laddningstillstånd
  const friendlyName = matchedName || 
    (isLoadingNames ? 'Laddar...' : fileNameWithoutExt.replace(/-/g, ' '));
  
  // ... rest of code
}, [getXeokitViewer, modelNamesMap, isLoadingNames]);

// Rad 289-348: Vänta tills modelNamesMap är klar (om laddning pågår)
useEffect(() => {
  // Don't initialize until model names are loaded (or loading failed)
  if (isInitialized || isLoadingNames) return;
  
  // Kräv att modelNamesMap har data om buildingFmGuid finns
  if (buildingFmGuid && modelNamesMap.size === 0) {
    // Names still loading, wait
    return;
  }
  
  // ... rest of initialization
}, [extractModels, isInitialized, applyModelVisibility, isLoadingNames, buildingFmGuid, modelNamesMap.size]);
```

---

## Problem 4: Saknade modeller i listan

### Rotorsak
Modeller laddas bara till xeokit efter att XKT-filer hämtats. Om synkronisering av XKT-modeller inte slutförts, finns modellerna inte i `viewer.scene.models`.

`extractModels()` itererar endast över `sceneModels` - modeller som faktiskt laddats in i xeokit-scenen.

### Lösning
Kombinera två datakällor:
1. **Laddade modeller** från xeokit scene
2. **Tillgängliga modeller** från `xkt_models` databastabellen

**Fil: `src/components/viewer/ModelVisibilitySelector.tsx`**

```tsx
// Ny state för databas-modeller
const [dbModels, setDbModels] = useState<{id: string; name: string}[]>([]);

// Hämta alla modeller för byggnaden från databasen
useEffect(() => {
  if (!buildingFmGuid) return;
  
  const fetchDbModels = async () => {
    const { data } = await supabase
      .from('xkt_models')
      .select('model_id, model_name, file_name')
      .eq('building_fm_guid', buildingFmGuid);
    
    if (data) {
      setDbModels(data.map(m => ({
        id: m.file_name || m.model_id,
        name: m.model_name || m.file_name || m.model_id
      })));
    }
  };
  
  fetchDbModels();
}, [buildingFmGuid]);

// Modifiera extractModels för att kombinera med dbModels
const extractModels = useCallback(() => {
  // ... hämta laddade modeller från scene
  
  // Lägg till databas-modeller som inte finns i scene (visas som "ej laddade")
  dbModels.forEach(dbModel => {
    if (!extractedModels.find(m => m.id === dbModel.id)) {
      extractedModels.push({
        id: dbModel.id,
        name: dbModel.name,
        shortName: dbModel.name.length > 30 ? dbModel.name.substring(0, 27) + '...' : dbModel.name,
        loaded: false, // Ny flagga för att markera ej laddade modeller
      });
    }
  });
  
  return extractedModels;
}, [getXeokitViewer, modelNamesMap, dbModels]);
```

---

## Problem 5: Modellträd - selektion propagerar inte

### Rotorsak
I `ViewerTreePanel.tsx` hanterar `handleVisibilityChange` (rad 462-484) endast synlighetsändringar för en nod och dess barn, men funktionen anropas med `visible: boolean` som alltid sätter samma värde - den hanterar inte propagering uppåt till förälder eller korrekt selektionssynkronisering.

### Lösning
1. **Propagera nedåt** - Redan implementerat (rad 472-481)
2. **Propagera uppåt** - Lägg till uppdatering av förälderns indeterminate-status
3. **Fixa expand/collapse** - Se till att `onToggle` är korrekt kopplat

**Fil: `src/components/viewer/ViewerTreePanel.tsx`**

```tsx
// Rad 462-484: Förbättra handleVisibilityChange för att propagera korrekt
const handleVisibilityChange = useCallback((node: TreeNode, visible: boolean) => {
  const xeokitViewer = getXeokitViewer();
  const scene = xeokitViewer?.scene;
  if (!scene) return;

  // Rekursiv funktion för att sätta synlighet på alla barn
  const setVisibilityRecursive = (n: TreeNode, vis: boolean) => {
    const entity = scene.objects?.[n.id];
    if (entity) {
      entity.visible = vis;
    }
    n.children?.forEach(child => setVisibilityRecursive(child, vis));
  };

  // Sätt synlighet på noden och alla dess barn
  setVisibilityRecursive(node, visible);

  // Uppdatera trädets visuella state
  refreshVisibilityState();
}, [getXeokitViewer, refreshVisibilityState]);
```

**Fixa TreeNodeComponent checkbox onClick**:
```tsx
// Rad 201-204: Korrigera event-hantering
<Checkbox
  checked={node.visible && !node.indeterminate}
  ref={(el) => {
    if (el && node.indeterminate) {
      // Sätt indeterminate-attribut på underliggande input
      const input = el.querySelector('input');
      if (input) input.indeterminate = node.indeterminate;
    }
  }}
  onCheckedChange={(checked) => {
    onVisibilityChange?.(node, !!checked);
  }}
  onClick={(e) => e.stopPropagation()}
/>
```

---

## Problem 6: Prestanda och partiell laddning

### Analys
XEOkits demo-sidor är snabba för att de:
1. **Laddar endast BIM-strukturen först** (hierarchy metadata)
2. **Laddar geometri on-demand** när användaren navigerar
3. **Använder WebGL-instancing** för duplicerade objekt

### Rekommendation
Detta är en större arkitekturell förändring som bör hanteras separat. En mellanlösning:

1. **Fördröj trädbygge** - ViewerTreePanel bygger redan trädet i chunks med `requestIdleCallback`
2. **Lazy-load barn** - Expandera inte trädnoder förrän användaren klickar
3. **Virtualisering** - Implementera react-window för stora träd

Notera: Dessa optimeringar bör dokumenteras för framtida implementation men ligger utanför denna plans scope.

---

## Filer som ändras

| Fil | Typ | Beskrivning |
|-----|-----|-------------|
| `src/pages/Viewer.tsx` | Ändra | Validering av vald byggnad |
| `src/index.css` | Ändra | Dölj Asset+ interna orange spinner |
| `src/components/viewer/ModelVisibilitySelector.tsx` | Ändra | Fixa modellnamn och visa alla tillgängliga modeller |
| `src/components/viewer/ViewerTreePanel.tsx` | Ändra | Förbättra checkbox-propagering |

---

## Tekniska detaljer

### Spinner-arkitektur efter fix
```text
┌───────────────────────────────────────┐
│ 3D Viewer Container                   │
│                                       │
│  ┌─────────────────────────────────┐  │
│  │ React Spinner (lila)            │  │  ← Kontrolleras av state.isLoading
│  │ Spinner component               │  │
│  └─────────────────────────────────┘  │
│                                       │
│  ┌─────────────────────────────────┐  │
│  │ Asset+ Internal Spinner (orange)│  │  ← DOLD via CSS
│  │ dx-loadindicator                │  │
│  └─────────────────────────────────┘  │
│                                       │
└───────────────────────────────────────┘
```

### Modellsynlighet dataflöde
```text
xkt_models (DB)  ────┐
                     ├──> Combined Model List ──> UI
scene.models     ────┘
     │
     └──> För laddade modeller: visibility control
```

---

## Implementeringsordning

1. **CSS-fix för orange spinner** - Snabb fix med omedelbar effekt
2. **Viewer.tsx validering** - Säkerställ att BuildingSelector visas
3. **ModelVisibilitySelector fixes** - Kombinera datakällor och förbättra namnvisning
4. **ViewerTreePanel checkbox-fix** - Korrekt propagering av visibility
