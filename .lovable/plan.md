

## Lägg till get-buildings action i FM Access edge function

### Problem
Vi vet inte vilka byggnads-ID:n som finns i FM Access (`swg-demo.bim.cloud`). Vi har GUID:s i vår databas men vet inte om de matchar FM Access-instansen. HDC API:et bör ha en endpoint for att lista byggnader.

### Steg

**1. Lägg till `get-buildings` action i `supabase/functions/fm-access-query/index.ts`**
Ny case i switch-satsen som anropar `/api/buildings` (HDC:s standard-endpoint for byggnader). Returnerar listan av byggnader med deras GUID:s, namn och annan metadata.

**2. Testa endpointen**
Anropa `get-buildings` for att se vilka byggnader som finns i FM Access-instansen och jämföra med våra lokala GUID:s.

**3. Om /api/buildings inte fungerar, testa alternativa endpoints**
HDC-plattformen kan ha andra endpoints som `/api/objects?category=Building` eller `/api/archive/buildings`. Vi testar tills vi hittar rätt.

### Teknisk detalj

```text
Ny case i switch-satsen:

case 'get-buildings': {
  const response = await fmAccessFetch(config, '/api/buildings');
  // parse response safely
  // return list of buildings with GUIDs
}
```

Detta ger oss en lista av byggnader i FM Access som vi kan mappa mot våra lokala byggnads-GUID:s.
