
# Plan: Standardisera Spinner, TreeView-höjd och Våningsplan-synkronisering

## Sammanfattning
Tre huvudproblem identifierade:

1. **Dubbla spinners** - En custom CSS-spinner i AssetPlusViewer och en annan i BuildingSelector. Standardisera på lila `Loader2`-ikonen från lucide-react.
2. **TreeView för litet** - `max-h-[40vh]` i embedded-läge är för litet. Dubbla höjden.
3. **Våningsplan-sliders ur synk** - UI visar bara ett våningsplan valt men hela byggnaden syns i 3D. Orsak: `applyFloorVisibility()` anropas aldrig vid initiering, bara vid användarinteraktion.

---

## Del 1: Standardisera Spinner

### Problem
I `AssetPlusViewer.tsx` (rad 2495-2505) finns en custom CSS-spinner med `border-t-primary`. Liknande i `BuildingSelector.tsx` (rad 204).

### Lösning

**1.1 Skapa en återanvändbar spinner-komponent**

Fil: `src/components/ui/spinner.tsx` (NY FIL)
```typescript
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  label?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
  xl: 'h-12 w-12',
};

export function Spinner({ size = 'md', className, label }: SpinnerProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <Loader2 className={cn(
        'animate-spin text-primary',
        sizeClasses[size],
        className
      )} />
      {label && <span className="text-sm text-muted-foreground">{label}</span>}
    </div>
  );
}
```

**1.2 Uppdatera AssetPlusViewer.tsx**

Ersätt rad 2495-2505:
```typescript
{/* Loading spinner overlay */}
{((state.isLoading && !state.isInitialized) || (xktSyncStatus === 'syncing' || xktSyncStatus === 'checking') && state.isInitialized) && (
  <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none bg-background/30">
    <Spinner 
      size="xl" 
      label={xktSyncStatus === 'syncing' ? 'Synkar 3D-modeller...' : undefined} 
    />
  </div>
)}
```

**1.3 Uppdatera BuildingSelector.tsx**

Ersätt rad 200-208:
```typescript
if (isLoadingData) {
  return (
    <div className="h-full flex items-center justify-center">
      <Spinner size="lg" label="Laddar byggnader..." />
    </div>
  );
}
```

**1.4 Uppdatera andra ställen som använder custom spinners**

Sök igenom kodbasen och ersätt alla `animate-spin` + `border-t-*` mönster med den nya `<Spinner />` komponenten för konsistens.

---

## Del 2: TreeView-höjd

### Problem
I embedded-läge har TreeView `max-h-[40vh]` (rad 890 i `ViewerTreePanel.tsx`).

### Lösning

Fil: `src/components/viewer/ViewerTreePanel.tsx`

Ändra rad 890:
```typescript
// Från:
<div ref={ref} className="flex flex-col h-full max-h-[40vh]">

// Till:
<div ref={ref} className="flex flex-col h-full max-h-[80vh]">
```

Detta dubblar den tillgängliga höjden för TreeView i desktop-läge.

---

## Del 3: Våningsplan-synkronisering

### Problem
Bilden visar att hela byggnaden är synlig i 3D, men bara "Plan A-00" har sin slider aktiverad i menyn. Detta beror på att:

1. Vid initiering läses sparad selection från localStorage
2. `setVisibleFloorIds()` uppdaterar UI-state korrekt
3. MEN `applyFloorVisibility()` anropas ALDRIG för att faktiskt applicera på 3D-scenen

### Lösning

Fil: `src/components/viewer/FloorVisibilitySelector.tsx`

Lägg till en ny `useEffect` efter rad 238 för att applicera initialt visibility-state:

```typescript
// Apply visibility to 3D scene when initialization completes
useEffect(() => {
  // Only apply once we have floors AND have finished initialization
  if (!isInitialized || floors.length === 0 || visibleFloorIds.size === 0) return;
  
  // Delay slightly to ensure 3D scene is ready
  const timeoutId = setTimeout(() => {
    console.log('Applying initial floor visibility:', Array.from(visibleFloorIds));
    applyFloorVisibility(visibleFloorIds);
    
    // Also emit the appropriate event based on selection
    if (visibleFloorIds.size === 1) {
      const soloFloorId = Array.from(visibleFloorIds)[0];
      const floor = floors.find(f => f.id === soloFloorId);
      const bounds = calculateFloorBounds(soloFloorId);
      
      const eventDetail: FloorSelectionEventDetail = {
        floorId: soloFloorId,
        floorName: floor?.name || null,
        bounds: bounds ? { minY: bounds.minY, maxY: bounds.maxY } : null,
      };
      window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, { detail: eventDetail }));
    }
  }, 100);
  
  return () => clearTimeout(timeoutId);
}, [isInitialized, floors, visibleFloorIds, applyFloorVisibility, calculateFloorBounds]);
```

### Varning: Undvik oändlig loop

`applyFloorVisibility` finns redan i dependency array för andra hooks. Se till att den nya useEffect:
- Endast triggas en gång efter initiering (via isInitialized-flagga)
- Inte triggar omrenderingar som leder till oändliga loopar

Om det behövs, lägg till en separat ref för att tracka om initial application redan skett:

```typescript
const initialVisibilityAppliedRef = useRef(false);

useEffect(() => {
  if (!isInitialized || floors.length === 0 || visibleFloorIds.size === 0) return;
  if (initialVisibilityAppliedRef.current) return;
  
  initialVisibilityAppliedRef.current = true;
  
  const timeoutId = setTimeout(() => {
    applyFloorVisibility(visibleFloorIds);
    // ... emit event
  }, 100);
  
  return () => clearTimeout(timeoutId);
}, [isInitialized, floors, visibleFloorIds]);
```

---

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/components/ui/spinner.tsx` | **NY FIL** - Standardiserad spinner-komponent |
| `src/components/viewer/AssetPlusViewer.tsx` | Ersätt custom spinner med `<Spinner />` |
| `src/components/viewer/BuildingSelector.tsx` | Ersätt custom spinner med `<Spinner />` |
| `src/components/viewer/ViewerTreePanel.tsx` | Ändra `max-h-[40vh]` till `max-h-[80vh]` |
| `src/components/viewer/FloorVisibilitySelector.tsx` | Lägg till useEffect för initial visibility application |

---

## Tekniska detaljer

### Spinner-hierarki
```text
Spinner storlekar:
- sm: h-4 w-4 (16px) - för inline/knappar
- md: h-6 w-6 (24px) - standard
- lg: h-8 w-8 (32px) - för kort och sektioner
- xl: h-12 w-12 (48px) - för fullscreen overlays
```

### Floor visibility flow (efter fix)
```text
1. Komponent mountar
2. localStorage läses → visibleFloorIds sätts till "Plan A-00"
3. Floors extraheras från metaScene
4. isInitialized = true
5. ✅ NY: useEffect triggas → applyFloorVisibility() anropas
6. 3D-scenen uppdateras att bara visa "Plan A-00"
7. UI och 3D är nu synkade
```

---

## Testning efter implementation

1. **Spinner:** Öppna 3D-viewern → verifiera att endast en lila Loader2-spinner visas (ingen orange)
2. **TreeView:** Öppna Modellträd → verifiera att panelen är dubbelt så hög som tidigare
3. **Våningsplan:** 
   - Solo-välj ett våningsplan
   - Stäng viewern och öppna igen
   - Verifiera att BÅDE slidern OCH 3D-scenen visar samma våningsplan
4. **Cross-check:** Välj "Visa alla" → verifiera att alla sliders aktiveras och hela byggnaden visas
