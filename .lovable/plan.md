
## Mål
1) Sluta med “auto-rotation/auto-fit” efter 30–45s (endast applicera sparad startvy).  
2) Ta bort “auto-sync vid start” som just nu triggar onödiga server-anrop + loggspam och kan kännas som att allt hänger.  
3) Gör Split 2D-planen snabb: sluta generera planbilden om och om igen, minska upplösning på mobil, och gör init mer event-driven.  
4) Ta bort “stöd-/hjälp-overlay” högst upp i 2D-planen (labels/tooltip/knappar som stör).

## Vad jag ser i koden som orsakar trögheten
- **Plötslig kamerarotation**: `NativeXeokitViewer` gör alltid `viewer.cameraFlight.flyTo({ aabb: viewer.scene.aabb })` efter att modeller laddats (rotation/”snurr” när den auto-fittar).
- **Auto-sync**: `NativeXeokitViewer` triggar `asset-plus-sync` när det saknas A-modeller/inga modeller. Edge-loggar visar “❌ No working 3D endpoint found” → detta blir bara extra latency + arbete utan nytta.
- **SplitPlanView kör för mycket jobb**:
  - init-polling + flera timeouts (100ms/1s/3s/6s) + `setInterval` retry var 2.5s + extra triggers på `modelLoaded` → kan innebära *många* `createStoreyMap()`-körningar.
  - `applyBlackWalls()` loopar över **alla metaObjects** varje gång planbild genereras (dyrt i stora modeller).
  - kameraoverlay uppdateras var 100ms (onödigt tätt på mobil).

## Klargjort val (från dina svar)
- **Kamerastart**: *Endast sparad startvy*  
- **Synkstrategi**: *Ingen auto-sync vid start*

## Design/Implementation (föreslagen lösning)

### A) Kamerabeteende: endast sparad startvy (ingen auto-fit)
**Fil:** `src/components/viewer/NativeXeokitViewer.tsx`
1. Ta bort/disable den automatiska `cameraFlight.flyTo({ aabb: ... })` som körs efter modell-laddning.
2. Låt kameran ligga kvar i sin initiala default (eller den som redan sätts), tills en sparad startvy appliceras.

**Fil:** `src/components/viewer/NativeViewerShell.tsx` (eller alternativt `NativeXeokitViewer.tsx`)
3. Implementera stöd för `LOAD_SAVED_VIEW_EVENT` även i native-viewern:
   - Lyssna på `window.addEventListener(LOAD_SAVED_VIEW_EVENT, ...)`.
   - Om viewer ännu inte är redo: spara eventet i en `useRef` som “pending”.
   - När viewer är redo + modeller laddade: applicera:
     - `viewer.camera.eye/look/up` från event
     - `viewer.camera.projection` (perspective/ortho)
     - om eventets `viewMode` är `2d` eller `3d`: dispatcha `VIEW_MODE_REQUESTED_EVENT` så att `ViewerToolbar` tar hand om 2D/3D-läget konsekvent.
   - Detta gör att UnifiedViewer’s start_view_id faktiskt fungerar även när vi använder native-motorn.

**Fil:** `src/pages/UnifiedViewer.tsx`
4. Skärp startvy-logiken:
   - Dispatcha `LOAD_SAVED_VIEW_EVENT` **endast** om `buildingData.startView` finns.
   - Ta bort/undvik “fallback” som kan byta vy-läge utan startvy.
   - Synka tajming bättre: hellre trigga när `VIEWER_MODELS_LOADED` kommer (eller när native viewer signalerar ready) än en hårdkodad 2s timeout, för att undvika att startvyn appliceras mitt i tung parsing.

### B) Ingen auto-sync vid start (men behåll manuell fallback)
**Fil:** `src/components/viewer/NativeXeokitViewer.tsx`
5. Ändra `needsSync`-logiken så att den **inte** auto-invokar `asset-plus-sync` vid start.
   - Om modeller saknas: visa tydligt fel/empty state med en **Manuell “Sync models”**-knapp (admin-only om ni vill), som användaren kan trycka vid behov.
6. Extra: när `asset-plus-sync` misslyckas med endpoint discovery (HTML istället för JSON), logga en kort varning men försök inte igen automatiskt i en loop.

### C) Split 2D-plan: gör den mycket lättare (en generation, caching, debounce)
**Fil:** `src/components/viewer/SplitPlanView.tsx`
7. Byt från “polling + många triggers” till en enklare state-machine:
   - Vänta in `VIEWER_MODELS_LOADED` → init StoreyViewsPlugin en gång.
   - Generera planbild **en gång** för aktuell storey (och sen igen endast när användaren byter våning).
   - Ta bort `retryInterval` samt de flesta multipla `setTimeout(generateMap, ...)` (behåll max 1–2 försök med debounce).
8. Inför caching:
   - `const mapCacheRef = useRef<Map<string, StoreyMap>>()`
   - Key = `${storeyId}:${width}` (eller bara storeyId om vi kör fast width på mobil)
   - Om cache finns: `setStoreyMap(cached)` direkt utan `createStoreyMap`.
9. Sänk kostnad per generation (mobil):
   - På mobil: sätt `width` lägre (ex 600–900) istället för `containerWidth*2` upp till 1600.
   - Kör `createStoreyMap` i `requestIdleCallback` (fallback `setTimeout`) så UI hinner rita “Loading…” innan den blockerande delen startar.
10. Optimera “svarta väggar”:
   - Precomputea en lista av entity-IDs att färga (endast wall/slab/beam/column) **en gång per storey** istället för att loopa alla metaObjects varje gång.
   - Alternativt: begränsa till storey-subtree (traversera children från metaStorey och samla ids).
11. Minska overlay-uppdateringar:
   - Ändra kameraoverlay från `setInterval(..., 100)` till t.ex. 250–500ms på mobil.

### D) Ta bort “stödmeddelanden i toppen” i 2D-planen
**Fil:** `src/components/viewer/SplitPlanView.tsx`
12. Ta bort/disable UI-element som ligger överst och stör:
   - `Hovered entity tooltip` (top-left)
   - `Refresh button` (top-right) eller göm den bakom långtryck/meny om ni vill behålla funktionen
   - Behåll endast en minimal loading/erroryta när det behövs, annars ren plan.

## Hur vi verifierar (efter implementation)
1. Mobil: öppna `/viewer?building=...&mode=3d` och mät:
   - Tid tills första render (utan att UI fryser helt).
   - Ingen plötslig “snurr/rotation” efter 30–45s.
2. Mobil: växla till `split2d3d`:
   - Planbild ska genereras max 1 gång initialt (och sen bara vid våningsbyte).
   - Ingen krasch vid pinch/pan.
3. Med start_view_id satt (t.ex. Centralstationen): verifiera att kameran direkt hamnar i sparad vy och inte auto-fittar.

## Filer som kommer ändras
- `src/components/viewer/NativeXeokitViewer.tsx` (ta bort auto-fit + disable auto-sync)
- `src/components/viewer/NativeViewerShell.tsx` (implementera LOAD_SAVED_VIEW_EVENT för native och applicera sparad vy)
- `src/pages/UnifiedViewer.tsx` (dispatcha startvy mer korrekt/inte via hårdkodad timeout)
- `src/components/viewer/SplitPlanView.tsx` (stora prestandafixar + ta bort top-overlays)

## Tekniska noter (så du vet vad som händer)
- Edge-loggarna “No working 3D endpoint found” kommer från auto-sync-försök. När vi tar bort auto-sync vid start ska de i princip försvinna vid normal användning.
- `StoreyViewsPlugin.createStoreyMap()` är CPU-tung; den måste behandlas som en “dyr operation”: körs sällan, cache:as, och helst i idle.
