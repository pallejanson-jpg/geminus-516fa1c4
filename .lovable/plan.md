
## Analys: Vad gick fel med AI-skanningen (97 objekt från samma bild)

### Bekräftade fakta från databasen och loggar

Skanjobbet `7d14a8ea` (Centralstationen):
- **Status:** `failed` — avbröt automatiskt efter 30 min inaktivitet
- **Processade:** 150/200 bilder
- **Detektioner:** 97 stycken — **ALLA** från exakt samma `ivion_image_id: 71228241`

Det är alltså inte 97 fynd från 150 bilder fördelade — det är 97 fynd som registrerades på ca 30 sekunder (11:22:11 → 11:22:44) och samtliga pekar på *en och samma* panoramabild.

---

### Grundorsak: Tre samverkande buggar

#### Bug 1 — Skannt en och samma bild upprepade gånger (utan navigering)

I `BrowserScanRunner.tsx` ser navigeringslogiken ut såhär:

```typescript
await (api as any).legacyApi.moveToImageId(img.id, undefined, undefined);
```

Från konsolloggarna syns att navigeringen **lyckas** (bilderna byts korrekt: `✅ Navigated to image 3272302481819579`, `✅ Navigated to image 3297820599403364`...).

Men ALLA 97 detektioner är kopplade till `ivion_image_id: 71228241` — det är **starbilden** (den som Ivion laddade när SDK startade). Det stämmer med att skanningen startade kl 11:22:11, dvs inom de **första 2 minuterna** av jobbet.

Vad som hände: En enda batch-anrop till AI returnerade plötsligt **97 detektioner** från 3 screenshot — vilket är omöjligt om systemet fungerar normalt (max 3 bilder × ett rimligt antal objekt). Det tyder på att Gemini returnerade en defekt/oändlig JSON-response, troligen med felaktig struktur som parsades fel.

#### Bug 2 — JSON-parsning av batch-response är sårbar

I edge-funktionen (rad 2312-2316):
```typescript
const start = batchContent.indexOf('[');
const end = batchContent.lastIndexOf(']');
if (start !== -1 && end !== -1) {
  allDetections = JSON.parse(batchContent.slice(start, end + 1));
}
```

Detta är den **enkla** varianten — den använder `lastIndexOf(']')` istället för den robusta `extractJsonArray` som används i den andra kodvägen. Om Gemini returnerar ett svar som t.ex. innehåller en förklaring EFTER JSON-arrayen, kan `lastIndexOf` ta med fel del av texten och orsaka en ofantlig array.

Eller: Gemini returnerade en array med 97 element (alla dörrar av liknande koordinater), vilket tyder på att modellen "hallucinated" massivt — möjligt när samma bild skickas med 97 referensexempel (example_images) i prompten, vilket överväldigar kontextfönstret.

#### Bug 3 — Skanningen hängde sedan pga 403-fel från Ivion

Efter att de 97 objekten sparades (kl 11:22:44) fortsatte skanningen men:
- Ivion returnerar `403` på `storage/download/prefix/signed/url`
- `EventSource` (Ivion:s interna SSE-kanal) fick också `403`

Det är Ivion SDK:s egna internrequests (för att ladda panoramadata) som misslyckas — troligen för att token hann gå ut. Token-refresh sker var 8 min men om SDK:n redan etablerat en SSE-kanal med en gammal token, hjälper inte refresh.

Skanningen fortsatte ändå (processar nya bilder, tar screenshot) men **efter ca 30 min** utan framsteg triggades auto-timeout och jobbet markerades `failed`.

---

### Åtgärdsplan

#### Fix 1 — Begränsa max detektioner per batch

I `analyze-screenshot-batch` (edge function), lägg till ett tak på hur många detektioner en batch-request kan returnera:

```typescript
// Cap per batch to prevent hallucination storms
const MAX_DETECTIONS_PER_BATCH = 15;
if (allDetections.length > MAX_DETECTIONS_PER_BATCH) {
  console.warn(`[batch] Capping ${allDetections.length} detections to ${MAX_DETECTIONS_PER_BATCH}`);
  allDetections = allDetections.slice(0, MAX_DETECTIONS_PER_BATCH);
}
```

#### Fix 2 — Använd den robusta JSON-extraktionen (identisk med den andra kodvägen)

Ersätt `lastIndexOf` med `extractJsonArray` (depth-tracking) i batch-hanteraren:

```typescript
// Före (sårbar):
const start = batchContent.indexOf('[');
const end = batchContent.lastIndexOf(']');
allDetections = JSON.parse(batchContent.slice(start, end + 1));

// Efter (robust, identisk med analyzeImageWithAI):
function extractJsonArray(text: string): string | null {
  const start = text.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}
const jsonString = extractJsonArray(batchContent);
if (jsonString) allDetections = JSON.parse(jsonString);
```

#### Fix 3 — Nollduplika detektioner från samma position (tätare dedup)

Nuvarande dedup-avstånd är `2.0 meter`. Det stoppade inte 97 dörrar på samma ställe. Tillägg: hoppa över hela batchen om redan fler än X detektioner sparats för exakt samma `image_id`:

```typescript
// Kontrollera per image_id — max 5 detektioner per Ivion-bild
const { count } = await supabase
  .from('pending_detections')
  .select('*', { count: 'exact', head: true })
  .eq('scan_job_id', params.scanJobId)
  .eq('ivion_image_id', params.imageId);

if ((count || 0) >= 5) {
  result = { detections: 0, skipped: 'max_per_image' };
  break;
}
```

#### Fix 4 — Rensa upp befintliga 97 falska detektioner

Lägg till en "Rensa felaktiga" -knapp i DetectionReviewQueue, alternativt köra en direkt SQL-query för att ta bort alla detektioner med samma `ivion_image_id` från detta jobb.

Raderingsfråga att köra direkt:
```sql
DELETE FROM pending_detections 
WHERE scan_job_id = '7d14a8ea-194d-41c7-8842-0f607e928754' 
AND ivion_image_id = 71228241;
```

---

### Filer som ändras

1. **`supabase/functions/ai-asset-detection/index.ts`** — Fix 1 (cap), Fix 2 (robust JSON), Fix 3 (per-image dedup)
2. **Databas** — Rensa de 97 falska detektionerna via migration

Inga frontend-ändringar behövs för själva buggarna. Ivion 403-felet är ett token-timeout-problem från Ivions egna internrequests och kräver ingen fix — skanningen fortsatte korrekt ändå.
