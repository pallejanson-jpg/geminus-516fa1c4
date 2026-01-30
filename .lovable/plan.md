
# Plan: Felsökning och förbättring av TreeView, Asset-synk & XKT-synk

## Sammanfattning av problem

Koden är implementerad men fungerar inte korrekt på grund av:
1. **TreeView fryser** - `requestIdleCallback` hjälper inte tillräckligt för stora träd
2. **Asset-synk triggas inte** - Villkoren för synk blockerar kanske körning
3. **XKT-synk saknar feedback** - Ingen laddningsindikator eller status

---

## Del 1: TreeView - Förbättrad prestanda med riktig virtualisering

### Problem
Trädet byggs fortfarande synkront i sin helhet inuti `requestIdleCallback`. För modeller med 10,000+ objekt räcker detta inte.

### Lösning
Implementera **chunked tree rendering** som bygger trädet i mindre bitar:

```typescript
// I buildTree funktionen, splitta till chunks
const CHUNK_SIZE = 100;
let processedCount = 0;

const processChunk = () => {
  if (processedCount >= allMetaObjects.length) {
    setIsLoading(false);
    return;
  }
  
  const chunk = allMetaObjects.slice(processedCount, processedCount + CHUNK_SIZE);
  // Process chunk...
  processedCount += CHUNK_SIZE;
  
  // Schedule next chunk
  requestIdleCallback(processChunk, { timeout: 50 });
};
```

### Ytterligare optimering: Lazy child rendering
Rendera inte barn förrän noden expanderas (redan delvis implementerat, men kan förbättras genom att skippa traversal helt för kollapsade noder).

---

## Del 2: Asset-synk - Förbättrad triggning och feedback

### Problem
Synk-logiken i `AssetsView` triggas kanske inte korrekt. Villkoret `localAssets.length > 0 || hasTriedSync` kan blockera för tidigt.

### Diagnos-tillägg
Lägg till mer detaljerad logging:

```typescript
useEffect(() => {
  const checkAndSyncAssets = async () => {
    console.log('AssetsView sync check:', { 
      localAssets: localAssets.length, 
      hasTriedSync, 
      fmGuid: facility.fmGuid,
      category: facility.category 
    });
    
    // ... resten av koden
  };
  checkAndSyncAssets();
}, [facility.fmGuid, facility.category, localAssets.length, hasTriedSync, toast]);
```

### Alternativ synk-trigger
Om `assets` prop alltid är tom (pga data inte passas), lägg till explicit refetch vid mount:

```typescript
useEffect(() => {
  // Force check on mount, ignore props
  if (!facility.fmGuid || facility.category !== 'Building') return;
  
  const init = async () => {
    const existing = await fetchAssetsForBuilding(facility.fmGuid);
    if (existing.length > 0) {
      setLocalAssets(existing);
    } else {
      // Trigger sync
      const result = await syncBuildingAssetsIfNeeded(facility.fmGuid);
      if (result.synced && result.count > 0) {
        const newAssets = await fetchAssetsForBuilding(facility.fmGuid);
        setLocalAssets(newAssets);
      }
    }
  };
  init();
}, [facility.fmGuid, facility.category]);
```

---

## Del 3: XKT-synk - Laddningsindikator och status

### Problem
`xktCacheService.ensureBuildingModels` triggas men ger ingen synlig feedback.

### Lösning
Lägg till synk-status i AssetPlusViewer:

```typescript
const [xktSyncStatus, setXktSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');

useEffect(() => {
  if (!buildingFmGuid) return;
  
  const ensureModels = async () => {
    setXktSyncStatus('syncing');
    try {
      const result = await xktCacheService.ensureBuildingModels(buildingFmGuid);
      setXktSyncStatus(result.cached ? 'done' : (result.syncing ? 'syncing' : 'idle'));
    } catch (e) {
      setXktSyncStatus('error');
    }
  };
  ensureModels();
}, [buildingFmGuid]);

// I renderingen:
{xktSyncStatus === 'syncing' && (
  <div className="absolute top-2 left-2 bg-amber-100 text-amber-800 px-2 py-1 rounded text-xs flex items-center gap-1">
    <Loader2 className="h-3 w-3 animate-spin" />
    Synkar XKT-modeller...
  </div>
)}
```

---

## Del 4: Fixa React ref-varning

### Problem
```
Warning: Function components cannot be given refs.
Check the render method of `AssetPlusViewer` → at ViewerTreePanel
```

### Lösning
AssetPlusViewer försöker ge ref till ViewerTreePanel som är en function component. Ta bort ref eller wrap med `React.forwardRef`:

```typescript
// Alternativ 1: Ta bort ref på ViewerTreePanel i AssetPlusViewer
// Alternativ 2: Om ref behövs, wrap ViewerTreePanel med forwardRef:
const ViewerTreePanel = React.forwardRef<HTMLDivElement, ViewerTreePanelProps>(
  ({ viewerRef, isVisible, onClose, ... }, ref) => {
    // Lägg till ref på root div om det behövs
  }
);
```

---

## Filer att ändra

| Fil | Ändringar |
|-----|-----------|
| `src/components/viewer/ViewerTreePanel.tsx` | Fixa chunked rendering, lös ref-varning |
| `src/components/portfolio/AssetsView.tsx` | Förbättra synk-triggning med explicit mount-check |
| `src/components/viewer/AssetPlusViewer.tsx` | Lägg till XKT-synk statusindikator, fixa ref till ViewerTreePanel |

---

## Diagram: Förbättrat synk-flöde

```text
┌─────────────────────────────────────────────────────────┐
│               Användare öppnar byggnad                  │
└─────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┴────────────────┐
          ▼                                 ▼
   ┌──────────────┐                  ┌──────────────┐
   │  AssetsView  │                  │AssetPlusViewer│
   │  mount       │                  │    mount      │
   └──────────────┘                  └──────────────┘
          │                                 │
          ▼                                 ▼
   fetchAssetsForBuilding()        ensureBuildingModels()
          │                                 │
          ▼                                 ▼
   ┌──────────────┐                  ┌──────────────┐
   │ count == 0?  │                  │ count == 0?  │
   └──────────────┘                  └──────────────┘
     │ JA       │ NEJ                  │ JA       │ NEJ
     ▼          ▼                      ▼          ▼
 syncBuilding  setLocalAssets      syncXKT     [använd cache]
 Assets()       (data)             Building()
     │                                 │
     ▼                                 ▼
 ┌────────────────┐              ┌────────────────┐
 │ Visa spinner:  │              │ Visa spinner:  │
 │ "Synkar..."    │              │ "Synkar XKT..."│
 └────────────────┘              └────────────────┘
     │                                 │
     ▼                                 ▼
 fetchAssets                     [Modeller cacheade]
 ForBuilding()
     │
     ▼
 setLocalAssets(newData)
```

---

## Sammanfattning

**Koden ÄR implementerad** men följande problem behöver åtgärdas:

1. TreeView chunked rendering behöver förbättras för att undvika frysning
2. Asset-synk behöver en mer robust mount-trigger istället för att lita på props
3. XKT-synk saknar visuell feedback
4. React ref-varning måste lösas för stabil rendering

Efter dessa ändringar ska alla tre funktioner fungera korrekt.
