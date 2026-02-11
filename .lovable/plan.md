

# Fix: AI-detektion hittar objekt men sparar inga

## Rotorsak

Tva problem identifierade fran nätverksdata:

1. **Skärmklipp skickas som viewport-bild men prompten säger "360 equirectangular panorama"** -- AI:n ser en vanlig perspektivbild men instrueras att leta i en panoramabild. Detta sänker konfidensen.

2. **Konfidenströskeln 0.3 filtrerar bort alla detektioner** -- AI:n returnerar detektioner (1-2 per bild) men alla har konfidens under 0.3 och kastas bort. Granskningskön förblir tom.

```text
Nätverksbevis:
  {"detections":0, "totalInImage":1}  -- 1 objekt hittat, 0 sparade
  {"detections":0, "totalInImage":2}  -- 2 objekt hittade, 0 sparade

Kod (rad 2074):
  if (det.confidence < 0.3) continue;  // <-- filtrerar bort allt
```

## Atgärder

### 1. Uppdatera system-prompten (edge function)

Ändra fran "360 equirectangular panorama" till "indoor photograph / viewport capture" sa att AI:n vet vad den tittar pa. Detta bor höja konfidensen markant.

**Fil:** `supabase/functions/ai-asset-detection/index.ts` (rad 752-775)

Fran:
```
You are an expert at detecting safety equipment in 360° equirectangular panorama images.
```
Till:
```
You are an expert at detecting objects and equipment in indoor photographs.
The images are viewport captures from a 360° indoor scanning system, showing a regular perspective view (not equirectangular).
```

### 2. Sänk konfidenströskeln

Ändra fran 0.3 till 0.1 -- detektioner med lag konfidens hamnar i granskningskön för manuell bedömning istället för att kastas.

**Fil:** `supabase/functions/ai-asset-detection/index.ts` (rad 2074)

Fran:
```typescript
if (det.confidence < 0.3) continue;
```
Till:
```typescript
if (det.confidence < 0.1) continue;
```

### 3. Lägg till diagnostik-loggning

Logga varje detektions object_type och confidence sa vi kan se exakt vad AI:n returnerar och varför det filtreras. Detta hjälper vid framtida felsökning.

**Fil:** `supabase/functions/ai-asset-detection/index.ts` (i analyze-screenshot, rad ~2073)

```typescript
console.log(`[analyze-screenshot] AI returned ${detections.length} raw detections:`);
for (const det of detections) {
  console.log(`  - ${det.object_type}: confidence=${det.confidence}, desc=${det.description?.slice(0, 80)}`);
}
```

### Sammanfattning

Tre ändringar i en fil (`supabase/functions/ai-asset-detection/index.ts`):
- Korrigera system-prompten (viewport, inte panorama)
- Sänk confidence-tröskeln (0.3 till 0.1)
- Lägg till loggning av raa AI-resultat

