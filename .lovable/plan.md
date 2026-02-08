
# Fix: 3D-viewer kraschar fortfarande pa mobil

## Problemanalys (djupare)

Trots Error Boundary, unhandledrejection-handler och WebGL context lost-hantering kraschar 3D-viewern fortfarande pa mobil. Efter djupanalys av 3000+ rader i AssetPlusViewer.tsx har jag identifierat 5 kvarvarande kraschvektorer:

### 1. Unawaited async promises (rad 1303-1315)
`loadLocalAnnotations()` och `loadAlarmAnnotations()` ar async-funktioner som anropas utan `.catch()`. try/catch runt dem fangar BARA synkrona fel, inte promise rejections.

### 2. Ingen window.onerror-handler
Endast `unhandledrejection` fangas globalt. Asset+ UMD-biblioteket kan kasta synkrona fel utanfor Reacts render-cykel som varken fangas av Error Boundary eller rejection-handleren.

### 3. XKT Cache Interceptor dubblerar minneanvandning
Fetch-interceptorn klonar VARJE XKT-respons via `.clone()` + `arrayBuffer()`, vilket fordubblar minnesanvandningen for stora BIM-modeller. Pa mobila enheter med begransat minne kan detta orsaka en total tab-krasch (out-of-memory) som INGEN JavaScript-handler kan fanga.

### 4. Ingen initieringstimeout
Om `initializeViewer` hangs (natverksforfragan som aldrig returnerar pa instabil mobilanslutning) ser anvandaren en evig spinner utan aterhamtningsmojlighet.

### 5. Cleanup race condition i fetch-interceptorn
Om komponenten avmonteras medan en interceptad fetch ar aktiv, nullstalls `originalFetchRef.current` av `restoreFetch()`, men interceptor-closuren refererar fortfarande till den, vilket kan orsaka ett null-referensfel.

---

## Losning: 5 andringar

### Steg 1: Lagg till window.onerror-handler (App.tsx)

Utoka den globala skyddsmekanismen i `src/App.tsx` med en `window.onerror`-handler som fangar synkrona fel fran Asset+ UMD-biblioteket. Denna handler kompletterar den befintliga `unhandledrejection`-handleren.

### Steg 2: Lagg till .catch() pa unawaited promises (AssetPlusViewer.tsx)

I `handleAllModelsLoaded` (rad 1303-1315), lagg till `.catch()` pa bade `loadLocalAnnotations()` och `loadAlarmAnnotations()` sa att deras promise-rejections fangas direkt, utan att forlita sig pa den globala handleren.

Fran:
```text
try {
  loadLocalAnnotations();
} catch (e) { ... }
```

Till:
```text
loadLocalAnnotations().catch(e =>
  console.error('loadLocalAnnotations failed:', e)
);
```

### Steg 3: Inaktivera XKT Cache Interceptor pa mobil (AssetPlusViewer.tsx)

Den storsta minnesbesparingen: pa mobila enheter ska `setupCacheInterceptor()` INTE anropas. Detta eliminerar dubblerad minnesanvandning fran `.clone()` + `arrayBuffer()` pa varje XKT-modell. Mobila anvandare far fortfarande modellerna fran API:et, men de cachas inte lokalt.

I `initializeViewer` (rad 2407):
```text
// Setup cache interceptor before viewer initialization
// SKIP on mobile to save memory - cache-on-load doubles memory usage
if (!isMobile) {
  setupCacheInterceptor();
}
```

### Steg 4: Lagg till initieringstimeout (AssetPlusViewer.tsx)

Lagg till en timeout pa 30 sekunder i `initializeViewer`. Om viewern inte lyckats initiera inom den tiden visas ett felmeddelande med "Forsok igen"-knapp. Pa mobil satter vi 20 sekunders timeout.

### Steg 5: Saker fetch-interceptor cleanup (AssetPlusViewer.tsx)

Skydda fetch-interceptorn mot null-referensfel vid avmontering:

```text
window.fetch = async (input, init) => {
  const original = originalFetchRef.current;
  if (!original) {
    // Interceptor has been cleaned up, use native fetch
    return fetch(input, init);
  }
  // ... rest of interceptor logic
};
```

Dessutom: i cleanup-funktionen (rad 2654-2696), anropa `restoreFetch()` FORST, innan viewer-cleanup, sa att interceptorn tas bort medan den fortfarande ar i ett konsistent tillstand.

---

## Sammanfattning av filandringar

| Fil | Andring |
|-----|---------|
| `src/App.tsx` | Lagg till window.onerror global handler |
| `src/components/viewer/AssetPlusViewer.tsx` | 4 andringar: .catch() pa async calls, inaktivera cache pa mobil, initieringstimeout, saker fetch-interceptor |

## Tekniska detaljer

### Global onerror-handler (App.tsx)
```text
useEffect(() => {
  const handleError = (event: ErrorEvent) => {
    console.error('[Global] Uncaught error:', event.error);
    event.preventDefault();
  };
  window.addEventListener('error', handleError);
  return () => window.removeEventListener('error', handleError);
}, []);
```

### Initieringstimeout (AssetPlusViewer.tsx)
En `AbortController`-baserad timeout laggs till i `initializeViewer`:
- Mobil: 20 sekunder
- Desktop: 45 sekunder
- Vid timeout: setState med felmeddelande "Initiering tog for lang tid", visa retry-knapp

### Minnesbesparingseffekt
Genom att inaktivera cache-interceptorn pa mobil elimineras:
- `.clone()` av varje XKT Response-objekt (kopierar HTTP-headers + stream)
- `.arrayBuffer()` av den klonade responsen (allokerar hela modellen i minne en gang till)
- Bakgrundsuppladdning till Supabase Storage (ytterligare minnesanvandning)

For en byggnad med 5 XKT-modeller a 10 MB = 50 MB extra minnesanvandning som nu undviks pa mobil.

### Risker och begransningar
- Mobila anvandare far inte XKT-caching, vilket innebar att modeller alltid laddas fran API:et. Detta ar en avvagning for stabilitet.
- Tab-krascher fran out-of-memory kan INTE fangas av nagon JavaScript-handler. Cache-optimeringen minskar risken men eliminerar den inte helt for mycket stora modeller.
- `window.onerror` kan inte fanga alla feltyper (t.ex. CORS-relaterade fel), men fangar de flesta synkrona fel fran tredjepartsbibliotek.
