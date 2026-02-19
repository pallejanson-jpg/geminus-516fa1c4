
## Diagnos: Viewern monteras men visar tomt — race condition i initieringsordning

### Vad loggarna bekräftar

Loggens sekvens är:
```
allModelsLoadedCallback           ← modeller är laddade
Model data or models array is not available  ← ERROR inuti Asset+ viewer
Spaces hidden by default via Asset+ API
allModelsLoadedCallback - got an FMGUID to look at
selectFmGuid 755950d9-...
```

XKT-data laddas korrekt (1,33 MB + 14 MB i minnet), men `getAnnotations` misslyckas direkt efter `allModelsLoadedCallback`. Det här är ett känt Asset+ Vue-internt timing-problem: `allModelsLoadedCallback` skjutar för tidigt, innan den interna datastrukturen `models` är populerad.

Andra kritiska observationer:
- Felet uppstår på **BOTH** desktop och mobil nu
- Loggarna har **dubbla** preload-meddelanden (`XKT Preload: 1/2 models loaded` visas **2 gånger**) — det tyder på att viewern mountas **DUBBELT** (React Strict Mode dubbelkörning + `UnifiedViewer` håller viewern i DOM hela tiden)
- `initializeViewer` körs med `initTimeout = 50ms` men setupCacheInterceptor (`useEffect([buildingFmGuid])`) kan köras **parallellt** och installera interceptorn före eller efter att viewern initialiseras

### Grundproblemet: HEAD-request blockerar cache-flödet

I interceptorn (rad 2822-2834) görs en **HEAD-request mot Asset+ API** för varje modell:
```typescript
const headResp = await original!(url, { method: 'HEAD' });
```

Detta anrop görs **inuti** den interceptade fetch. Om HEAD-requesten misslyckas (timeout, 403, CORS-problem) kastar den ett undantag som fångas i `catch` och ignoreras — men om den är **långsam** (t.ex. 5-10 sekunder) blockeras hela modelladdningen tills HEAD-requesten är klar.

Effekt på desktop vs mobil:
- Desktop: CORS-policies och corporate-nätverk kan blockera HEAD-requests annorlunda
- Mobil: Kan ha fungerat p.g.a. enklare nätverkssituation (mobilt data vs WiFi routing)

### Åtgärdsplan: Ta bort HEAD-check + förenkla interceptorn

Problemet med nuvarande interceptor-logik är att den är för komplex och blockerar viewer-init. Lösningen är att **ta bort HEAD-requesten** och istället bara kolla åldern på cache-posten (vi har redan `stale`-flaggan via datum-jämförelse i `checkCache`).

#### Ändring 1: `src/components/viewer/AssetPlusViewer.tsx` — Ta bort HEAD-check

Ersätt HEAD-requestblocket (rad 2820-2851) med en enklare logik som bara kollar om cache-posten är äldre än 7 dagar (via `cacheResult.stale` som redan finns):

```typescript
// BEFORE (slow, blocking HEAD request):
if (!cacheResult.stale) {
  try {
    const headResp = await original!(url, { method: 'HEAD' });
    const sourceLastMod = headResp.headers.get('Last-Modified');
    // ... lengthy HEAD comparison logic
  } catch {
    // silently ignored
  }
  if (!sourceNewer) {
    // use cache
  }
}

// AFTER (fast, date-based only):
if (!cacheResult.stale) {
  console.log(`XKT cache: Database hit for ${modelId}, fetching from storage`);
  const cachedResponse = await original!(cacheResult.url, init);
  if (cachedResponse.ok) {
    const data = await cachedResponse.clone().arrayBuffer();
    storeModelInMemory(modelId, resolvedBuildingGuid, data);
    return new Response(data, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' }
    });
  }
}
```

Detta eliminerar en potentiellt blockerande nätverksanrop och förenklar cacheflödet markant.

#### Ändring 2: `src/components/viewer/AssetPlusViewer.tsx` — Skydda `getAnnotations`-anropet

Felet `Model data or models array is not available` uppstår för att `getAnnotations` anropas för tidigt. Lägg till en liten fördröjning (100ms) innan vi kallar funktioner som beror på modelldata:

Hitta i `handleAllModelsLoaded` callback-sektionen och skydda annotations-anropet:
```typescript
// Existing (crashes immediately):
viewer.getAnnotations?.(...);

// Fixed (wait for Vue to propagate model data):
setTimeout(() => {
  try {
    viewer.getAnnotations?.(...);
  } catch (e) {
    console.warn('getAnnotations: models not ready yet', e);
  }
}, 100);
```

#### Ändring 3: Desktop-specifik fix — Verifiera att containern har rätt höjd

Loggarna visar att viewern initialiseras (`Initialization completed in 0.2s`) men är osynlig. En container med `height: 0` skulle ge exakt detta symptom. Lägg till ett explicit `height: 100%` på containern i JSX:

```typescript
// viewerContainerRef div ska ha explicit height
style={{
  display: 'flex',
  flexDirection: 'column',
  height: '100%',  // ← Säkerställ att detta finns
  minHeight: 0,    // ← Krävs för flex children att respektera förälderns höjd
  // ... rest
}}
```

### Filer som ändras

| Fil | Ändring |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | 1) Ta bort HEAD-check i interceptorn, 2) Skydda `getAnnotations` med timeout, 3) Explicit `height: 100%` + `minHeight: 0` på container |

Inga edge functions, inga databas-ändringar, inga nya beroenden.

Dessa ändringar gäller exakt samma kod för desktop och mobil (unified code path) — fix på ett ställe fixar båda.
