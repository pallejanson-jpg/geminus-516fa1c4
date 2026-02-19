
## Rotorsak: Korrupt cachad XKT-fil i storage

### Det definitiva beviset

**Console-felet är:**
```
RangeError: Offset is outside the bounds of the DataView
  at DataView.prototype.getUint32
  at fJ._parseModel (assetplusviewer.umd.min.js:522:376042)
```

Detta är **ingen nätverksfel, ingen autentiseringsfel.** Det är Asset+ SDK:ns XKT-parser som kraschar för att binärdata är korrupt eller ogiltig.

**Databasen visar:**
```
model_id:    0e687ea4-cdd0-48b0-bed1-df7fe588f648
file_size:   9,215,200 bytes (9.2 MB) ← ser OK ut
storage_path: 9baa7a3a-.../0e687ea4-....xkt
synced_at:   2026-02-18 16:05:52
```

**Nätverksloggarna visar (konsekvent):**
```
XKT cache: Memory hit for bc185635-9507-41b6-93d4-a7d484acc0fd  ← MINNESTRÄFF
allModelsLoadedCallback                                           ← callback körs
RangeError: Offset is outside the bounds of the DataView         ← KRASCHAR vid parse
```

**Minnesträffen är problemet.** Sekvensen är:
1. `useXktPreload` laddar XKT-filen från storage (signerad URL) och sparar i minnet
2. Cache-interceptorn returnerar minnesdata direkt när SDK:n begär filen
3. SDK:n försöker parsa data → `RangeError` → krasch → viewer visas aldrig

Varför är minnesdata korrupt? Troligtvis laddades filen ned från en **utgången signerad URL** (de lever bara 3600 sekunder = 1 timme). Om `useXktPreload` fetchar från en signerad URL som gick ut, returnerar Supabase storage ett **HTML-felmeddelande** istället för binär XKT-data. Den HTML-strängen sparas sedan i minnesminnet (`xktMemoryCache`), och när SDK:n sedan begär filen returneras HTML — inte XKT — vilket orsakar `RangeError` vid parsing.

Observera att koden i `useXktPreload.ts` (rad 160-163) har en guard mot korrupta filer:
```typescript
if ((model.file_size || 0) < 50_000) {
  console.warn(`Skipping ${model.model_id} — file_size too small (likely corrupt)`);
  return;
}
```

Men `file_size` i databasen är **9.2 MB** (korrekt storlek) — guarddatat matchar det lagrade metadatat, inte den faktiska storleken på vad som fetches. Om signad URL är utgången och returnerar en HTML-respons på t.ex. 500 bytes, accepteras ändå data eftersom databasens `file_size` valideras istället för `data.byteLength`.

Dessutom: `useXktPreload` validerar inte svarens `Content-Type` eller kontrollerar att svaret faktiskt är binär XKT-data. Det räcker att `response.ok` är true.

Ytterligare bekräftelse: den konsol-loggen visar `Memory hit for bc185635-...` men databas-posten är `0e687ea4-...`. Det är **ett annat model-ID!** Det betyder att minnesminnet från en tidigare session innehåller data för `bc185635-...` som aldrig rensas.

### Tre-stegs-fix

#### Fix 1 — Validera binärdata i `useXktPreload` och `setupCacheInterceptor` vid minneslagring

Lägg till validering av faktisk binärstorlek och XKT-header när data hämtas och lagras i minnet:

```typescript
// Validate before storing to memory
const MIN_VALID_XKT_BYTES = 50_000;
const headerBytes = new Uint8Array(data, 0, Math.min(4, data.byteLength));
const firstChar = String.fromCharCode(headerBytes[0]);
const isHtmlOrJsonResponse = firstChar === '<' || firstChar === '{';

if (data.byteLength < MIN_VALID_XKT_BYTES || isHtmlOrJsonResponse) {
  console.warn(`XKT Preload: Skipping ${model.model_id} — data invalid (${data.byteLength} bytes, starts with '${firstChar}')`);
  return;
}
storeModelInMemory(model.model_id, buildingFmGuid, data);
```

#### Fix 2 — Rensa minnesminnet vid viewer-initiering

Det mest direkta symptomet är att minnesminnet innehåller korrupt/gammal data från tidigare sessions. Lägg till en rensning i `initializeViewer` innan cacheinterceptorn sätts upp:

```typescript
// In initializeViewer, before setupCacheInterceptorRef.current():
import { clearBuildingFromMemory } from '@/hooks/useXktPreload';

// Clear stale in-memory XKT cache for this building
// (prevents corrupt data from previous sessions being served to the parser)
clearBuildingFromMemory(buildingFmGuid);
console.log('AssetPlusViewer: Cleared in-memory XKT cache for fresh load');
```

`clearBuildingFromMemory` existerar redan i `useXktPreload.ts` men anropas aldrig vid viewer-init.

#### Fix 3 — Verifiera Content-Type och byteLength när data hämtas från storage-URL i cache-interceptorn

I `setupCacheInterceptor` (rad 2826-2833), när cached data hämtas från storage, validera svaret:

```typescript
const cachedResponse = await original!(cacheResult.url, init);
if (cachedResponse.ok) {
  const data = await cachedResponse.clone().arrayBuffer();
  // Validate data before serving and storing
  const MIN_XKT_BYTES = 50_000;
  const firstByte = data.byteLength > 0 ? String.fromCharCode(new Uint8Array(data)[0]) : '';
  if (data.byteLength >= MIN_XKT_BYTES && firstByte !== '<' && firstByte !== '{') {
    storeModelInMemory(modelId, resolvedBuildingGuid, data);
    return new Response(data, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
  } else {
    console.warn(`XKT cache: Corrupt cache data for ${modelId} (${data.byteLength} bytes), falling through to fresh fetch`);
    // Fall through to fetch from Asset+ API
  }
}
```

### Varför token-fixarna inte hjälpte

- Token är giltigt och API-anropen returnerar 200 OK (bekräftat i nätverksloggen)
- `GetAllRelatedModels` och `PublishDataServiceGet` returnerar båda 200 OK med korrekt data
- Crashen sker i **XKT-parsern** (Asset+ SDK internt) när den försöker tolka minnesminne-data som inte är giltig XKT-binärdata
- Token-cachelogiken är irrelevant eftersom crashen inträffar före/efter autentiseringsflödet

### Filer som ändras

| Fil | Ändring |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | 1) Anropa `clearBuildingFromMemory(buildingFmGuid)` i `initializeViewer`, 2) Lägg till binärvalidering i cache-interceptorn |
| `src/hooks/useXktPreload.ts` | Lägg till binärvalidering (`byteLength` + header-byte) innan `storeModelInMemory` anropas |

Inga edge functions, inga databasändringar, inga nya beroenden.

### Varför detta löser problemet

1. `clearBuildingFromMemory` vid viewer-init rensar ut alla eventuellt korrupta minnesdata från tidigare sessions
2. Binärvalidering i preload och interceptor förhindrar att HTML-felsvar sparas som "XKT-data"
3. Om storage-URL är utgången och returnerar HTML: interceptorn faller igenom och hämtar från Asset+ API istället för att serva korrupt data
4. SDK:n får alltid giltig XKT-binärdata att parsa → ingen `RangeError`
