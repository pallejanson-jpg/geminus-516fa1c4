
# Plan: Fixa 3D Viewer och XKT-cachning

## Problem

3D-viewern kraschar med felet "Cannot read properties of null (reading 'nextSibling')" och XKT-cachningen skickar tom data (0.00 MB).

## Orsaksanalys

1. **DOM-rensning saknas**: Memory-dokumentet kräver att `innerHTML` rensas innan initialization, men denna kod saknas
2. **XKT cache interceptor-problem**: `response.clone().arrayBuffer()` returnerar tom data för Asset+ GetXktData-anrop
3. **Race conditions**: React Strict Mode dubbelmontering orsakar konflikter

## Lösning

### Del 1: Fixa DOM-rensning i AssetPlusViewer

Lägg till explicit rensning av viewer-containern innan varje initieringsförsök:

```typescript
// I initializeViewer, efter DOM wait-loopen:
if (viewerContainerRef.current) {
  // CRITICAL: Clear container before initialization to prevent 'nextSibling' errors
  viewerContainerRef.current.innerHTML = '';
}
```

### Del 2: Inaktivera XKT fetch-interceptorn

Eftersom interceptorn orsakar problem och skickar tom data, kommer vi temporärt inaktivera den tills vi kan felsöka ordentligt:

```typescript
// Ändra setupCacheInterceptor till att vara en no-op:
const setupCacheInterceptor = useCallback(() => {
  // XKT cache interceptor disabled temporarily - causing initialization issues
  // Models will be loaded directly from Asset+ API without caching
  console.log('XKT cache: Interceptor disabled (using direct load)');
}, []);
```

### Del 3: Behåll memory-cache för preload

Preload-systemet kan fortfarande fungera, men ska inte störa viewer-initieringen. Modeller som förhandsladdas kan användas som fallback.

## Filändringar

| Fil | Ändring |
|-----|---------|
| `src/components/viewer/AssetPlusViewer.tsx` | Lägg till `innerHTML = ''` rensning före init, inaktivera fetch interceptor |

## Detaljerade kodändringar

### AssetPlusViewer.tsx - initializeViewer

Runt rad 1180-1195, efter DOM-vänteloopen:

```typescript
if (!containerReady || !viewerContainerRef.current) {
  setInitStep('error');
  setState(prev => ({
    ...prev,
    isLoading: false,
    error: '3D container missing in DOM. Try again or reload the page.',
  }));
  return;
}

// CRITICAL FIX: Clear container innerHTML before initialization
// This prevents 'nextSibling' null errors during React mount/unmount cycles
viewerContainerRef.current.innerHTML = '';

setModelLoadState('idle');
setCacheStatus(null);
```

### AssetPlusViewer.tsx - setupCacheInterceptor

Ersätt hela funktionen (runt rad 1073-1142):

```typescript
// XKT cache interceptor - DISABLED due to initialization conflicts
// The interceptor was causing 'nextSibling' errors and sending empty data to cache
// Models will load directly from Asset+ API for now
const setupCacheInterceptor = useCallback(() => {
  console.log('XKT cache: Interceptor disabled (direct loading mode)');
  // No-op - don't override fetch
}, []);
```

Ta även bort anropet till `restoreFetch()` i cleanup om det inte längre behövs.

## Framtida förbättringar (ej i denna fix)

När viewern fungerar stabilt kan XKT-cachningen återimplementeras genom att:
1. Använda service worker istället för fetch-interceptor
2. Eller: Haka in i Asset+ viewer callbacks för modelladdning
3. Eller: Proaktiv cachning via `asset-plus-sync` edge function

## Testning

Efter implementation:
1. Öppna 3D viewer för en byggnad
2. Verifiera att modellen laddas utan fel
3. Testa "Välj position i 3D" i inventeringsformuläret
4. Verifiera att koordinaterna sparas korrekt
