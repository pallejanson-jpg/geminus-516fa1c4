
# Fix: 3D-laddning fungerar inte

## Rotorsak

Det finns en kritisk timing/matching-bugg i fetch-interceptorn som kombinerat med `additionalDefaultPredicate` skapar ett "dubbelt filter" som kan blockera hela 3D-laddningen.

### Problem A: Interceptorn returnerar 404 på fel modeller

Interceptorn på rad 2793–2796 returnerar `{ status: 404 }` för modeller som inte finns i `allowedModelIdsRef`. Logiken bakom är att "skjuta upp" laddning av icke-A-modeller. **Men detta är fel approach** — Asset+ viewer tolkar 404 som ett permanent fel och hoppar *inte* över till nästa modell. Resultatet: ingen modell laddas alls.

### Problem B: Timing-race med `allowedModelIdsRef`

`allowedModelIdsRef` sätts inuti den asynkrona `initializeViewer`-funktionen. Interceptorn är aktiv från det att `setupCacheInterceptor` anropas. Om en gammal viewer-instans lämnat kvar ett gammalt värde i `allowedModelIdsRef` när ny byggnad laddas → fel filter tillämpas för nya byggnaden.

### Problem C: URL-filtret är för brett

`url.toLowerCase().includes('threed')` matchar även Lovable Storage-URL:er när cachadde XKT hämtas därifrån (sökvägen kan innehålla "threed" i namnet). Effekten: interceptorn försöker filtrera anrop till Lovable Storage och kan returnera 404 på dem.

### Problem D: additionalDefaultPredicate + interceptor = dubbelt filter

`additionalDefaultPredicate` (i Asset+ viewer-init) filtrerar vilka modeller viewern *frågar* om. Interceptorn filtrerar *fetch-svaren*. Om de inte är synkroniserade (t.ex. olika strängformat för model-ID) → viewern frågar om modell X, interceptorn tror det inte är tillåtet, returnerar 404.

## Lösning

### Fix 1: Ta bort 404-returneringen ur interceptorn (KRITISK)

Interceptorn ska **aldrig** returnera 404. Den ska antingen:
- Returnera data från cache (om cachad)
- Passera igenom till originalfetch (om inte cachad)

Det är `additionalDefaultPredicate` som avgör vilka modeller viewern laddar — interceptorn ska bara cache:a och leverera, inte blockera.

```typescript
// BEFORE (fel - returnerar 404):
if (!isAllowed) {
  console.log(`XKT filter: Skipping non-initial model ${modelId}`);
  return new Response(null, { status: 404, statusText: 'Model deferred' });
}

// AFTER (korrekt - passa igenom):
if (!isAllowed) {
  console.log(`XKT filter: Non-initial model ${modelId}, passing through without caching`);
  return original!(input, init);  // Låt viewern hantera det
}
```

### Fix 2: Strikta URL-filter i interceptorn

Begränsa interceptorn till bara Asset+ API-URL:er, inte Lovable Storage-URL:er:

```typescript
// BEFORE (för brett):
const isXktRequest = url.includes('.xkt') || 
                     url.toLowerCase().includes('getxktdata') ||
                     url.toLowerCase().includes('threed');

// AFTER (striktare - bara Asset+ API):
const isXktRequest = (url.includes('.xkt') && !url.includes('storage.googleapis') && !url.includes('supabase')) || 
                     url.toLowerCase().includes('getxktdata');
// Notera: 'threed' tas bort som ensam trigger
```

### Fix 3: Rensa allowedModelIdsRef vid ny byggnad

Nollställ `allowedModelIdsRef.current = null` i cleanup/reset innan ny `initializeViewer` startar, för att undvika timing-race.

```typescript
// I cleanup-funktionen / vid start av initializeViewer:
allowedModelIdsRef.current = null;
```

### Fix 4: additionalDefaultPredicate — ladda alla om nameMap är tom

Om `GetModels` misslyckas för en byggnad (404, timeout) → `nameMap` är tom → `allowedModelIdsRef.current = null`. Det är korrekt. Men just nu loggas bara en debug-rad och predicaten returnerar `true`. Det fungerar men vi måste se till att `allowedModelIdsRef.current = null` faktiskt sätts korrekt i alla felfall:

```typescript
// Säkerställ att null sätts explicit vid fel:
} catch (e) {
  console.debug('Model filter setup failed — loading all models:', e);
  allowedModelIdsRef.current = null;  // Explicit: ladda allt
}
```

## Konkreta filändringar

### Fil: `src/components/viewer/AssetPlusViewer.tsx`

**Ändring 1** (rad ~2788–2796): Ta bort 404-returnering, ersätt med passthrough:
```typescript
if (!isAllowed) {
  console.log(`XKT filter: Non-initial model ${modelId} — passing through`);
  return original!(input, init);
}
```

**Ändring 2** (rad ~2776–2778): Skärp URL-filtret:
```typescript
const isXktRequest = (url.includes('.xkt') && 
                      !url.includes('supabase') && 
                      !url.includes('googleapis') &&
                      !url.includes('storage.')) || 
                     url.toLowerCase().includes('getxktdata');
```

**Ändring 3** (rad ~3170): Säkerställ explicit null-reset vid fel:
```typescript
} catch (e) {
  console.debug('Model filter setup failed — loading all models:', e);
  allowedModelIdsRef.current = null;
}
```

**Ändring 4**: Nollställ `allowedModelIdsRef` i cleanup och i början av `initializeViewer`:
```typescript
// Tidigt i initializeViewer, innan async-arbetet:
allowedModelIdsRef.current = null;
```

## Tekniska detaljer

### Varför fungerade det ibland men inte alltid?

Byggnader som **redan hade XKT cachat** i memory (t.ex. `0e687ea4-...` som syns i loggar) – dessa levererades direkt från memory-cache och nådde aldrig 404-koden. Problemet uppstår bara när:
1. Ny byggnad öppnas (inget i memory)
2. Model-ID:t av någon anledning inte matchas exakt mot whitelist
3. Intercept returnerar 404 → viewern fastnar

Loggen visar `XKT Memory: Stored 0e687ea4-... (8.79 MB, total: 17.58 MB)` — samma modell lagras **dubbelt** (8.79 × 2 = 17.58 MB). Det är en annan bugg i memory-cachen (dubbel-lagring), men den blockerar inte laddningen.

### Varför hämtas från Lovable/Supabase Storage?

Det är korrekt beteende — det är vår XKT-cache. Modellen hämtas från Asset+ första gången, sparas till Lovable Storage, och nästa gång hämtas den därifrån (snabbare). Problemet är bara att interceptorn fick dessa URL:er att passera genom `isXktRequest`-filtret.

## Prioritet

Ändring 1 (ta bort 404) är den mest kritiska — den bör ensam räcka för att fixa att 3D inte startar. Övriga ändringar förbättrar robusthet och eliminerar edge-cases.
