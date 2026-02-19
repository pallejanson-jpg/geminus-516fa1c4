
## Rotorsak: Två separata problem måste lösas

### Problem 1 — `getAnnotations` kraschar inuti Asset+ SDK (inte vår kod)

Loggarna visar stack trace från `assetplusviewer.umd.min.js:534:33175` — det är Asset+ **interna** `allModelsLoadedCallback` som anropar `getAnnotations` av sig självt. Vi kan inte stoppa det med vår `setTimeout` eftersom det är SDK:ns egna interna anrop som sker vid fel tidpunkt.

Loggsekvensen:
```
allModelsLoadedCallback           ← vår callback triggas
Model data or models array is not available  ← SDK INTERN krasch (ej vår kod)
Spaces hidden by default          ← vår kod fortsätter
```

Detta är ett känt problem med Asset+ 2.5.1 — `allModelsLoadedCallback` skjutar för tidigt. Vi kan inte fixa SDK:ns interna race condition. **Men** — detta är troligen inte orsaken till att 3D inte visas. SDK:n hanterar felet internt och fortsätter.

### Problem 2 — Viewern renderar inte (tom canvas) — trolig rotorsak

XKT-data hämtas korrekt (bekräftat i network requests: `200 OK` med 1,33 MB binärdata från storage). Men viewern är osynlig. Det tyder på att:

**Hypotes:** `initializeViewer` injicerar `freshDiv` dynamiskt inuti `viewerContainerRef`. Om `viewerContainerRef` har `height: 100%` men dess **förälder** saknar explicit höjd, kollapsar hela stacken till 0px.

Från diff:n syns att vi lade till:
```typescript
height: '100%',
minHeight: 0,
```
till `viewerContainerRef`. Men problemet kan vara att **föräldern** (`dx-viewport`) har `h-full` från Tailwind, och den i sin tur är inuti `flex-1 min-h-0` — en flex-kedja som kan brytas.

### Åtgärdsplan: Tre riktade fixar

#### Fix 1 — Ta bort `getAnnotations` från vår kod helt

Vi behöver inte anropa `getAnnotations` manuellt — Asset+ SDK gör det internt. Vår nuvarande kod (`onToggleAnnotation(true)` + `getAnnotations()`) **dubbelanropar** det. Ta bort `getAnnotations`-anropet, behåll bara `onToggleAnnotation(true)`:

```typescript
// Behåll:
assetViewer.onToggleAnnotation(true);
// Ta bort (SDK anropar detta internt):
// assetViewer.getAnnotations();  ← RADERAS
```

#### Fix 2 — Öka setTimeout-fördröjningen från 100ms till 500ms

100ms räcker inte för Vue:s interna state-propagering i Asset+ 2.5.1. Höj till 500ms för att ge SDK:n tillräckligt med tid:

```typescript
setTimeout(() => {
  try {
    const viewer = viewerInstanceRef.current;
    const assetViewer = viewer?.assetViewer;
    if (assetViewer?.onToggleAnnotation) {
      assetViewer.onToggleAnnotation(true);
      console.log("Annotations enabled");
      // NOTE: Do NOT call getAnnotations() here — SDK handles it internally
    }
  } catch (e) {
    console.warn("Could not enable annotations:", e);
  }
}, 500);
```

#### Fix 3 — Lägg till explicit pixel-höjd på viewerContainerRef (inte bara `height: '100%'`)

`height: '100%'` fungerar inte alltid i flex-kedjor med dynamisk layout. Lägg till `flex: '1 1 auto'` och `position: 'relative'` som säkerhetsnät:

```typescript
style={{
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',        // ← Tar upp tillgängligt utrymme i flex-förälder
  height: '100%',
  minHeight: 0,
  position: 'relative',   // ← Krävs för absolute-positionerade barn (loading overlay)
  background: ...,
}}
```

Och på `dx-viewport`-wrappern (som är `viewportWrapperRef`):
```typescript
className="dx-viewport relative w-full h-full"
style={{ margin: 0, display: 'flex', flexDirection: 'column' }}
```

### Filer som ändras

| Fil | Ändring |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | 1) Ta bort `getAnnotations()`-anrop från vår callback, 2) Höj timeout till 500ms, 3) Lägg till `flex: '1 1 auto'` + `position: 'relative'` på container, 4) Lägg till `display: flex` på `dx-viewport` wrapper |

Inga edge functions, inga databasändringar, inga nya beroenden. Samma kodstig för desktop och mobil.
