
## Grundlig diagnos av 3D-viewer-felet

### Vad loggarna visar (faktisk sekvens)

```
allModelsLoadedCallback           ← modeller laddade (detta är rätt)
Model data or models array is not available  ← SDK:ns interna krasch
Spaces hidden by default          ← vår kod fortsätter normalt
NavCube initialized successfully  ← allt detta körs korrekt
...
[AssetPlusViewer] ⏱ Initialization completed in 0.2s ← klar
```

Viewern **initialiseras**, XKT-data hämtas (bekräftat i network: 200 OK med 1,33 MB), modeller laddas, callbacks körs — men canvasen är **osynlig**. Felet `Model data or models array is not available` är SDK-internt och är inte orsaken.

### Rotorsak identifierad: `buildingFmGuid` är `undefined` vid viewer-init

Rad 506–510 i `AssetPlusViewer.tsx`:
```typescript
const assetData = allData.find((a: any) => a.fmGuid === fmGuid);
const buildingFmGuid = assetData?.buildingFmGuid || assetData?.fmGuid;
```

`allData` laddas asynkront från AppContext. Vid första render är `allData` tom (`[]`) → `assetData` är `undefined` → `buildingFmGuid` är `undefined`.

`initializeViewer` har dependency-array `[fmGuid, initialFmGuidToFocus, isMobile]` — den bryr sig **inte** om `buildingFmGuid`. Initieringslogiken (rad 2990):
```typescript
if (!isMobile) {
  setupCacheInterceptorRef.current();  ← anropas med buildingFmGuid = undefined
}
```

Interceptorn tidigt-returnerar om `buildingFmGuid` saknas (rad 2758–2761):
```typescript
if (!resolvedBuildingGuid) {
  console.log('XKT cache: No building GUID, skipping interceptor');
  return;
}
```

**Effekt:** Interceptorn installeras aldrig. Viewer-init fortsätter utan cache. Sedan (rad 3100–3183) görs ett API-anrop till Asset+ `GetModels` som returnerar **404**:

```
GET .../api/threed/GetModels?fmGuid=... → 404
```

Detta förorsakar att `allowedModelIdsRef.current` förblir `null` och A-modell-filtret baserat på modellnamn inte kan byggas upp. Viewer-instansen skapas, men `GetAllRelatedModels` returnerar **401** (rad i network):

```
POST .../GetAllRelatedModels → 401
```

Det är 401-felet som gör att Asset+ SDK inte kan ladda modellen visuellt — den har inget att visa.

### Varför det fungerade tidigare

Tidigare hämtades modellnamn från databasen direkt (utan API-fallback), och `buildingFmGuid` löstes troligtvis i tid eftersom `allData` var cachad. De senaste ändringarna av interceptor-logiken (ta bort HEAD-request, lägga till `GetModels`-API-anrop) introducerade:
1. Ett nytt nätverksanrop till `GetModels` som returnerar 404 (endpoint existerar ej för alla byggnader)
2. `GetAllRelatedModels` POST som returnerar 401 — detta verkar vara ett **autentiseringsproblem med Asset+ Bearer-token** vs API-nyckel-baserat auth

### Sekundärt problem: Mobile navigation för bred

`MobileNav.tsx` — knappen ändrades men behöver ytterligare responsive-justering för att passa bättre på smala skärmar (360px).

---

## Åtgärdsplan: Exakt tre riktade fixar

### Fix 1 — Ta bort `GetModels`-API-anropet som returnerar 404

Blocket på rad 3120–3160 gör ett `fetch` till `GetModels`-endpointen som returnerar 404. Ta bort detta API-anrop helt. Lita istället enbart på databasens `xkt_models`-tabell för modellnamn (som redan fungerar):

```typescript
// REMOVE this entire block:
if (nameMap.size === 0) {
  const apiBase = baseUrl.replace(...)
  const resp = await fetch(`${apiBase}/api/threed/GetModels?...`)
  // ... 
}
```

Om `nameMap.size === 0` → ladda alla modeller (ingen filtrering). Detta är säkrare och eliminerar 404-felet.

### Fix 2 — Lös `buildingFmGuid` från `fmGuid`-prop direkt (utan att vänta på `allData`)

`buildingFmGuid` bestäms nu av `assetData?.buildingFmGuid`, men `assetData` kan vara `undefined` om `allData` inte är laddad än. Eftersom `fmGuid`-propen som skickas in till viewern **alltid är byggnadens GUID** (inte ett rum eller en våning), kan vi använda `fmGuid` direkt:

```typescript
// RAD 510 - ersätt:
const buildingFmGuid = assetData?.buildingFmGuid || assetData?.fmGuid;

// MED:
// fmGuid is always the building GUID when passed from UnifiedViewer
// Fall back to assetData lookup only if needed (for room/floor deep-links)
const buildingFmGuid = fmGuid || assetData?.buildingFmGuid || assetData?.fmGuid;
```

Detta garanterar att `setupCacheInterceptor` alltid har ett giltigt GUID och installeras korrekt.

### Fix 3 — Mobil navigation: smalare layout

`MobileNav.tsx` — justera bredden på "Meny"-knappen och text för att passa bättre på smala mobil-skärmar:
- Göm knapp-texten på extra-smala skärmar (`< sm`)
- Minska padding ytterligare

---

## Teknisk sammanfattning av ändrade filer

| Fil | Ändring |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | 1) Rad 510: `buildingFmGuid = fmGuid` som primär källa, 2) Rad 3120–3160: Ta bort `GetModels` API-anrop |
| `src/components/layout/MobileNav.tsx` | Smalare Meny-knapp med dold text på smala skärmar |

Inga edge functions, inga databasändringar, inga nya beroenden. Exakt samma kodstig för desktop och mobil.

### Varför detta löser problemet

1. `buildingFmGuid = fmGuid` (prop) fungerar omedelbart, utan att vänta på `allData`
2. Interceptorn installeras alltid med korrekt GUID
3. `GetModels` 404 tas bort → inga onödiga nätverksfel
4. `GetAllRelatedModels` 401 är troligen en sidoeffekt av felaktig timing — med korrekt GUID-kedja bör Asset+ SDK:n initiera korrekt med Bearer-tokenet

Om `GetAllRelatedModels` fortsätter returnera 401 efter dessa fixar, innebär det ett separat autentiseringsproblem med Asset+ staging-miljöns token, vilket inte kan åtgärdas från vår kodbas.
