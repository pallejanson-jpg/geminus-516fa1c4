
# Plan: Förbättrad TreeView Performance, Desktop UI & On-Demand Synk

## Sammanfattning

Tre huvudproblem att lösa:

1. **TreeView-prestanda** - Appen fryser vid rendering av stora modellträd
2. **TreeView Desktop UI** - Behöver vara resizable, transparent och draggable (som UniversalPropertiesDialog)
3. **Tom Asset-lista** - On-demand synk från Asset+ fungerar inte korrekt för Centralstationen

## Svar på din fråga

**Modellträdets datakälla:** Data kommer från **XKT-filernas metaScene** (xeokits interna metadata från 3D-modellerna), INTE från Lovable-databasens tabeller (Building/Floor/Room/Asset). När en XKT-modell laddas i viewern extraheras hierarkin från modellens inbyggda IFC-struktur.

---

## Del 1: TreeView Performance-optimering

### Problem
Trädet byggs synkront vilket fryser UI:t när det finns tusentals noder. `TreeNodeComponent` har ineffektiv `useCallback`-användning.

### Lösningar

**A. Virtualisering/Lazy Rendering**
Rendera endast synliga noder istället för hela trädet:

```typescript
// Använd memoization och limitera initial rendering
const [visibleNodes, setVisibleNodes] = useState<Set<string>>(new Set());
const [renderLimit, setRenderLimit] = useState(100); // Initial gräns

// Rendera i chunks med requestIdleCallback
useEffect(() => {
  if (treeData.length > 0) {
    const buildInChunks = (nodes: TreeNode[], index: number) => {
      if (index >= nodes.length) return;
      
      requestIdleCallback(() => {
        // Process batch of nodes
        const batch = nodes.slice(index, index + 50);
        setVisibleNodes(prev => {
          const next = new Set(prev);
          batch.forEach(n => next.add(n.id));
          return next;
        });
        buildInChunks(nodes, index + 50);
      });
    };
    buildInChunks(treeData, 0);
  }
}, [treeData]);
```

**B. Memoize TreeNodeComponent**
```typescript
const TreeNodeComponent = React.memo(({ node, ... }) => {
  // Flytta hasMatchingChildren till useMemo utanför komponenten
  const shouldShow = useMemo(() => {
    if (!searchQuery) return true;
    return matchesSearch || childrenMatchSearch;
  }, [searchQuery, node.name, node.type]);
  
  if (!shouldShow) return null;
  // ...
});
```

**C. Debounce Search**
```typescript
const [debouncedSearch, setDebouncedSearch] = useState('');

useEffect(() => {
  const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
  return () => clearTimeout(timer);
}, [searchQuery]);
```

---

## Del 2: TreeView Desktop UI (Resizable, Draggable, Transparent)

### Lägg till samma funktionalitet som UniversalPropertiesDialog

```typescript
// Nya states
const [position, setPosition] = useState({ x: 12, y: 56 });
const [size, setSize] = useState({ width: 320, height: 400 });
const [isDragging, setIsDragging] = useState(false);
const [isResizing, setIsResizing] = useState(false);
const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

// Drag handlers
const handleDragStart = (e: React.MouseEvent) => {
  setIsDragging(true);
  setDragOffset({
    x: e.clientX - position.x,
    y: e.clientY - position.y,
  });
};

// Resize handler (SE corner)
const handleResizeStart = (e: React.MouseEvent) => {
  e.preventDefault();
  setIsResizing(true);
  setResizeStart({
    x: e.clientX,
    y: e.clientY,
    width: size.width,
    height: size.height,
  });
};

// Mouse move/up effects för drag och resize
useEffect(() => {
  if (!isDragging) return;
  
  const handleMouseMove = (e: MouseEvent) => {
    setPosition({
      x: Math.max(0, e.clientX - dragOffset.x),
      y: Math.max(0, e.clientY - dragOffset.y),
    });
  };
  
  const handleMouseUp = () => setIsDragging(false);
  
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
  return () => {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };
}, [isDragging, dragOffset]);
```

### Panel styling (transparent + floating)
```tsx
<div 
  className={cn(
    "fixed z-50", // Fixed istället för absolute
    "bg-card/90 backdrop-blur-md border rounded-lg shadow-xl", // Transparent
    "flex flex-col"
  )}
  style={{
    left: position.x,
    top: position.y,
    width: size.width,
    height: size.height,
  }}
>
  {/* Draggable header */}
  <div 
    className="flex items-center justify-between p-3 border-b cursor-move"
    onMouseDown={handleDragStart}
  >
    <GripVertical className="h-4 w-4 text-muted-foreground" />
    <span>Modellträd</span>
    <Button variant="ghost" size="icon" onClick={onClose}>
      <X className="h-4 w-4" />
    </Button>
  </div>
  
  {/* Content... */}
  
  {/* Resize handle - SE corner */}
  <div
    className="hidden sm:block absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10"
    onMouseDown={handleResizeStart}
  >
    <svg className="w-3 h-3 absolute bottom-1 right-1 text-muted-foreground" viewBox="0 0 10 10">
      <path d="M0 10 L10 0 M4 10 L10 4 M7 10 L10 7" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  </div>
</div>
```

---

## Del 3: On-Demand Asset & XKT Synk (Fallback)

### Problem
När man öppnar AssetsView för Centralstationen visas "Inga assets hittades" trots att synk-logik finns.

### Analys av befintlig kod

`AssetsView` har redan on-demand synk (rad 196-226):
```typescript
useEffect(() => {
  const checkAndSyncAssets = async () => {
    if (assets.length > 0 || !facility.fmGuid) return;
    if (facility.category !== 'Building') return;
    
    setIsSyncingAssets(true);
    const result = await syncBuildingAssetsIfNeeded(facility.fmGuid);
    // ...
  };
  checkAndSyncAssets();
}, [facility.fmGuid, facility.category, assets.length, toast]);
```

### Problem
1. `assets.length > 0` - Om assets kommer från props och redan är tom, avbryts synk
2. Synken triggas men resultatet uppdaterar inte listan (inget refresh av data)
3. Toast visas men data uppdateras inte i UI

### Lösning

**A. Lägg till lokal state för synkade assets:**
```typescript
const [localAssets, setLocalAssets] = useState<any[]>(assets);
const [hasTriedSync, setHasTriedSync] = useState(false);

useEffect(() => {
  setLocalAssets(assets);
}, [assets]);

useEffect(() => {
  const checkAndSyncAssets = async () => {
    if (localAssets.length > 0 || hasTriedSync) return;
    if (!facility.fmGuid || facility.category !== 'Building') return;
    
    setHasTriedSync(true);
    setIsSyncingAssets(true);
    
    try {
      const result = await syncBuildingAssetsIfNeeded(facility.fmGuid);
      
      if (result.synced && result.count > 0) {
        // Fetch newly synced assets from database
        const newAssets = await fetchAssetsForBuilding(facility.fmGuid);
        setLocalAssets(newAssets);
        
        toast({
          title: 'Assets synkade',
          description: `Hämtade ${result.count} assets för denna byggnad`,
        });
      }
    } catch (error: any) {
      toast({
        title: 'Kunde inte synka assets',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSyncingAssets(false);
    }
  };
  
  checkAndSyncAssets();
}, [facility.fmGuid, facility.category, localAssets.length, hasTriedSync]);
```

**B. Visa laddningsindikator under synk:**
```tsx
{isSyncingAssets && (
  <div className="flex items-center justify-center py-8 gap-2">
    <Loader2 className="h-6 w-6 animate-spin" />
    <span>Synkar assets från Asset+...</span>
  </div>
)}
```

**C. Samma logik för XKT i AssetPlusViewer:**
```typescript
// I AssetPlusViewer, lägg till on-demand XKT sync
useEffect(() => {
  if (!fmGuid) return;
  
  const ensureModels = async () => {
    const result = await xktCacheService.ensureBuildingModels(fmGuid);
    if (result.syncing) {
      console.log('XKT sync triggered for building:', fmGuid);
    }
  };
  
  ensureModels();
}, [fmGuid]);
```

---

## Filer som Påverkas

| Fil | Ändringar |
|-----|-----------|
| `src/components/viewer/ViewerTreePanel.tsx` | Prestanda: virtualisering, memoization. UI: drag, resize, transparency |
| `src/components/portfolio/AssetsView.tsx` | Lokal state för synkade assets, refetch efter synk |
| `src/components/viewer/AssetPlusViewer.tsx` | On-demand XKT sync trigger |

---

## Visuell Översikt

```text
┌── FÖRBÄTTRAT MODELLTRÄD (Desktop) ──────────────────┐
│ ⋮⋮ Modellträd                           [−] [×]   │ ← Draggable header
├────────────────────────────────────────────────────┤
│ 🔍 Sök...                                          │
├────────────────────────────────────────────────────┤
│ ☑ Våning 1                                    ▼   │
│   ☑ Vägg 1                                        │
│   ☑ Vägg 2                                        │
│   ☐ Dörr 1                                        │
│ ☑ Våning 2                                    ▼   │
│                                                    │
│                                               ⟋   │ ← Resize handle
└────────────────────────────────────────────────────┘
     ↑ Transparent bakgrund (bg-card/90)
     ↑ Kan flyttas och ändra storlek

ASSET-LISTA MED SYNK:
┌────────────────────────────────────────────────────┐
│ Assets i Centralstationen                          │
├────────────────────────────────────────────────────┤
│                                                    │
│    ⟳ Synkar assets från Asset+...                 │ ← Laddningsindikator
│                                                    │
├────────────────────────────────────────────────────┤
│ (Efter synk: visar hämtade assets)                 │
└────────────────────────────────────────────────────┘
```

---

## Tekniska Detaljer

### Prestanda-optimeringar

1. **React.memo** på TreeNodeComponent för att undvika onödiga re-renders
2. **requestIdleCallback** för att bygga trädet i bakgrunden
3. **Debounced search** för att minska beräkningar vid snabb skrivning
4. **Lazy expansion** - rendera bara barn när noden expanderas

### On-Demand Synk Flöde

```text
Användare öppnar AssetsView
         ↓
    assets.length === 0?
         ↓ JA
    syncBuildingAssetsIfNeeded(fmGuid)
         ↓
    Edge function: sync-single-building
         ↓
    Spara till 'assets' tabell
         ↓
    fetchAssetsForBuilding(fmGuid)
         ↓
    setLocalAssets(newAssets)
         ↓
    Visa assets i listan
```

---

## Förväntade Resultat

1. **Snabbare TreeView** - Ingen UI-frysning vid stora modeller
2. **Flexibel desktop-panel** - Draggable, resizable, semi-transparent
3. **Alltid data i Asset-listan** - On-demand synk fyller listan automatiskt
4. **Konsekvent UX** - Samma interaktionsmönster som UniversalPropertiesDialog
