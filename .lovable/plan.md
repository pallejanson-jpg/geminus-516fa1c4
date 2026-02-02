
# Åtgärdsplan: 360-view, Preloading, StartView, TreeView och Viewer-problem

## Sammanfattning
Du har identifierat flera allvarliga problem som behöver åtgärdas:

1. **360+ Close-knapp fungerar inte** - `onClose` skickas som tom funktion
2. **Trög förladning av byggnadsinformation** - Preloading behöver optimeras
3. **My Favorites är långsamt** - Data hämtas ej tillräckligt effektivt
4. **Saknar "Startvy" per byggnad** - Behöver kunna koppla en sparad vy som standard
5. **Modell-laddning är långsam** - Preload-system behöver verifieras
6. **Alla våningsplan ska vara collapsed som standard** - TreeView auto-expanderar fel
7. **TreeView expand-pil fungerar stötvis** - Event-propagation-problem
8. **Kryssruta-avmarkering ska dölja objekt i 3D** - Fungerar redan men "None" synkar ej med checkboxar
9. **None-knappen synkar inte med trädet** - Ska avmarkera alla checkboxar
10. **Expand/Collapse är långsamt** - Performance-problem i stor träd
11. **Rumsetiketter fungerar fortfarande inte** - Floor-filtrering triggas ej korrekt
12. **2D-klipphöjd fungerar inte** - SectionPlane skapas inte korrekt

---

## Del 1: 360+ Close-knapp

### Problem
I `MainContent.tsx` rad 89 skickas en tom funktion `onClose={() => {}}` till `Ivion360View`.

### Lösning
Fil: `src/components/layout/MainContent.tsx`
- Hämta `setActiveApp` från AppContext
- Implementera riktig close-funktion som navigerar tillbaka till 'portfolio' eller föregående app
- Spara föregående app innan 360-view öppnas (liknande viewer3d-mönstret)

```typescript
// I MainContent.tsx
const [previousAppBefore360, setPreviousAppBefore360] = useState('portfolio');

// I switch case 'radar':
return (
  <Ivion360View 
    onClose={() => {
      setActiveApp(previousAppBefore360);
    }} 
  />
);
```

Alternativt: Lägg till 360-state i AppContext med samma mönster som `setViewer3dFmGuid`.

---

## Del 2: Trög förladning och My Favorites

### Problem
- `useFavoriteBuildings()` i HomeLanding triggar en databas-query varje gång
- Ingen caching av favorites mellan navigeringar
- `useXktPreload` anropas men modelldata laddas inte proaktivt i minnet

### Lösning

**2.1 Cache favorites i AppContext**
Fil: `src/context/AppContext.tsx`
- Lägg till `favoriteBuildings: string[]` state
- Ladda favorites en gång vid startup
- Exponera `refreshFavorites()` för manuell uppdatering

**2.2 Optimera useFavoriteBuildings hook**
Fil: `src/hooks/useBuildingSettings.ts`
- Använd React Query eller SWR för caching
- Eller cacha i localStorage med TTL

**2.3 Preload XKT till minnet, inte bara cache-check**
Fil: `src/hooks/useXktPreload.ts`
- Nuvarande kod kontrollerar bara om cache finns
- Lägg till faktisk fetch och lagring i `xktMemoryCache`

```typescript
// I preloadModels():
const result = await xktCacheService.ensureBuildingModels(buildingFmGuid);
if (result.cached && result.count > 0) {
  // Faktiskt ladda binärdata till minnet
  const models = await xktCacheService.getCachedModels(buildingFmGuid);
  models.forEach(model => {
    storeModelInMemory(model.id, buildingFmGuid, model.data);
  });
}
```

---

## Del 3: Startvy per byggnad

### Problem
Användaren vill kunna sätta en sparad vy som "Startvy" för en byggnad - den vy som alltid laddas när byggnaden öppnas i 3D.

### Lösning

**3.1 Utöka building_settings-tabellen**
```sql
ALTER TABLE building_settings ADD COLUMN IF NOT EXISTS start_view_id UUID REFERENCES saved_views(id);
```

**3.2 Lägg till "Sätt som startvy"-knapp i CreateViewDialog eller BuildingSelector**
Fil: `src/components/viewer/VisualizationToolbar.tsx`
- När en vy sparas, ge möjlighet att markera som "Startvy"
- Checkbox: "Använd som startvy för denna byggnad"

Fil: `src/components/viewer/BuildingSelector.tsx`
- Visa vilken vy som är startvy
- Knappar för att ändra/ta bort startvy

**3.3 Ladda startvy automatiskt i AssetPlusViewer**
Fil: `src/components/viewer/AssetPlusViewer.tsx`
- Vid initiering, kolla `building_settings.start_view_id`
- Om det finns, dispatcha `LOAD_SAVED_VIEW_EVENT` med vyns data
- Alla inställningar (kamera, modeller, floors, showSpaces, etc.) appliceras

**3.4 Utöka saved_views med fler inställningar**
Nuvarande kolumner täcker: camera, viewMode, clipHeight, visibleModels, visibleFloors, showSpaces, showAnnotations, visualizationType

Eventuellt behöver vi lägga till:
- `show_room_labels: boolean`
- `show_minimap: boolean`
- `show_navcube: boolean`
- `architect_mode: boolean`

---

## Del 4: TreeView-problem

### 4.1 Alla våningsplan ska vara collapsed som standard

**Problem:** Rad 648-660 i `ViewerTreePanel.tsx` auto-expanderar de första 2 nivåerna.

**Lösning:** Ändra `expandToDepth` till 0 eller ta bort auto-expand helt.

Fil: `src/components/viewer/ViewerTreePanel.tsx`
```typescript
// Rad 648-660: Ta bort eller ändra till 0 nivåer
// Auto-expand first 0 levels (all collapsed)
const autoExpandIds = new Set<string>();
// Kommentera bort expandToDepth-anropet eller sätt maxDepth till 0
// expandToDepth(tree, 0, 0); // eller ta bort helt
setExpandedIds(autoExpandIds);
```

### 4.2 Expand-pil fungerar stötvis

**Problem:** `e.stopPropagation()` i rad 210-211 kan blockeras av parent onClick.

**Lösning:** Säkerställ att click-eventet inte bubblar uppåt
Fil: `src/components/viewer/ViewerTreePanel.tsx`
```typescript
// Rad 209-221 - Lägg till bättre event-hantering
<button
  onClick={(e) => {
    e.stopPropagation();
    e.preventDefault();
    onToggle(node.id);
  }}
  className="p-0.5 hover:bg-muted rounded"
>
```

### 4.3 None-knappen synkar inte med trädet

**Problem:** `handleVisibilityAll(false)` i rad 773-783 döljer alla objekt i 3D men uppdaterar inte trädets checkboxar korrekt.

**Lösning:** Uppdatera tree-state för att sätta `visible: false` på alla noder.

Fil: `src/components/viewer/ViewerTreePanel.tsx`
```typescript
const handleVisibilityAll = useCallback((visible: boolean) => {
  const xeokitViewer = getXeokitViewer();
  const scene = xeokitViewer?.scene;
  if (!scene) return;

  try {
    scene.setObjectsVisible(scene.objectIds, visible);
    
    // NYTT: Uppdatera treeData för att reflektera nya visibility-state
    setTreeData(prevTree => {
      const updateAllNodes = (nodes: TreeNode[]): TreeNode[] => {
        return nodes.map(node => ({
          ...node,
          visible: visible,
          indeterminate: false,
          children: node.children ? updateAllNodes(node.children) : undefined,
        }));
      };
      return updateAllNodes(prevTree);
    });
  } catch (e) {
    console.debug('ViewerTreePanel: Error toggling all visibility:', e);
  }
}, [getXeokitViewer]);
```

### 4.4 Expand/Collapse är långsamt

**Problem:** `handleExpandAll` itererar hela trädet synkront.

**Lösning:** Använd chunked processing eller debounce.

```typescript
const handleExpandAll = useCallback(() => {
  // Använd requestIdleCallback för att inte blockera UI
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(() => {
      const allIds = new Set<string>();
      const collectIds = (nodes: TreeNode[]) => {
        nodes.forEach(node => {
          allIds.add(node.id);
          if (node.children) collectIds(node.children);
        });
      };
      collectIds(treeData);
      setExpandedIds(allIds);
    }, { timeout: 500 });
  } else {
    // Fallback
    setTimeout(() => {
      const allIds = new Set<string>();
      // ...samma logik
      setExpandedIds(allIds);
    }, 0);
  }
}, [treeData, setExpandedIds]);
```

---

## Del 5: Rumsetiketter

### Problem
Rumsetiketter skapas men floor-filter triggas inte korrekt vid Solo-val. I konsol-loggen syns `✅ Created 799 room labels (0 filtered by floor)` vilket betyder att filtret inte appliceras.

### Analys
- `visibleFloorFmGuids` skickas inte korrekt till `createLabels()`
- `updateFloorFilter()` anropas inte vid floor-selection-ändringar

### Lösning

**5.1 Lyssna på FLOOR_SELECTION_CHANGED_EVENT i AssetPlusViewer**
Fil: `src/components/viewer/AssetPlusViewer.tsx`
```typescript
// Ny useEffect för att synka room labels med floor filter
useEffect(() => {
  const handleFloorChange = (e: CustomEvent) => {
    const { floorId } = e.detail || {};
    // Uppdatera visibleFloorFmGuids baserat på nuvarande floor-selection
    // Och anropa updateFloorFilter på roomLabels-hooken
    if (updateFloorFilter) {
      updateFloorFilter(visibleFloorFmGuids);
    }
  };
  
  window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorChange as EventListener);
  return () => window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorChange as EventListener);
}, [visibleFloorFmGuids, updateFloorFilter]);
```

**5.2 Anropa updateFloorFilter i handleVisibleFloorsChange**
Se till att `handleVisibleFloorsChange()` i AssetPlusViewer även anropar `updateFloorFilter()`.

---

## Del 6: 2D-klipphöjd

### Problem
Konsol-loggen visar `❌ Could not create SectionPlane - no method available`. SectionPlane-API:t hittas inte på xeokit-viewern.

### Analys
Koden i `useSectionPlaneClipping.ts` provar flera metoder att skapa SectionPlane men ingen fungerar. Detta beror troligen på att:
1. Asset+ viewer wrappern exponerar inte xeokit's SectionPlane-API direkt
2. Viewern använder en annan plugin-struktur

### Lösning
Verifiera xeokit API-åtkomst genom att kontrollera Asset+ dokumentationen:

Fil: `src/hooks/useSectionPlaneClipping.ts`
```typescript
// Logga alla tillgängliga metoder på viewer och scene
const getXeokitViewer = useCallback(() => {
  const viewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  if (viewer && !debugLoggedRef.current) {
    console.log('xeokit viewer methods:', Object.keys(viewer));
    console.log('xeokit scene methods:', Object.keys(viewer.scene || {}));
    console.log('sectionPlanes:', viewer.scene?.sectionPlanes);
    debugLoggedRef.current = true;
  }
  return viewer;
}, [viewerRef]);
```

Eventuellt behöver vi:
- Använda Asset+ viewer's egna clip-API istället för xeokit direkt
- Kontrollera om det finns en `SectionPlanesPlugin` tillgänglig

---

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/components/layout/MainContent.tsx` | Fix 360-view onClose |
| `src/context/AppContext.tsx` | Lägg till favoriteBuildings caching |
| `src/hooks/useBuildingSettings.ts` | Optimera data-hämtning |
| `src/hooks/useXktPreload.ts` | Faktiskt ladda modeller till minnet |
| `src/components/viewer/ViewerTreePanel.tsx` | Fix collapsed default, None-knapp synk, expand/collapse performance |
| `src/components/viewer/AssetPlusViewer.tsx` | Synka room labels med floor filter, ladda startvy |
| `src/components/viewer/VisualizationToolbar.tsx` | Lägg till "Sätt som startvy"-option |
| `src/hooks/useSectionPlaneClipping.ts` | Debug och fix SectionPlane-API |
| `src/hooks/useRoomLabels.ts` | Säkerställ floor-filter triggas |

### Databasändring
```sql
ALTER TABLE building_settings 
ADD COLUMN IF NOT EXISTS start_view_id UUID REFERENCES saved_views(id);
```

---

## Prioritetsordning

1. **360-view Close-knapp** - Enkel fix, stor påverkan
2. **TreeView None-knapp och collapsed default** - UX-kritiskt
3. **Rumsetiketter floor-filtrering** - Funktionalitetsfix
4. **2D-klipphöjd** - Kräver API-investigation
5. **Startvy per byggnad** - Ny funktion
6. **Preloading-optimering** - Performance
7. **Expand/Collapse performance** - Performance

---

## Testning efter implementation

1. **360+ Close:** Öppna 360-view från Portfolio/QuickActions → klicka Close → verifiera att man kommer tillbaka
2. **TreeView collapsed:** Öppna TreeView → verifiera att alla noder är ihopfällda
3. **None-knappen:** Klicka "None" → verifiera att alla checkboxar avmarkeras OCH alla objekt döljs
4. **Rumsetiketter:** Solo-välj ett våningsplan → slå på rumsetiketter → verifiera att bara det våningsplanets etiketter visas
5. **2D-klipphöjd:** Aktivera 2D-läge → justera klipphöjd-slider → verifiera att klippning ändras
6. **Startvy:** Spara en vy som startvy → stäng viewern → öppna byggnaden igen → verifiera att startvyn laddas
7. **My Favorites:** Navigera till Home → verifiera att favorites laddas snabbt
