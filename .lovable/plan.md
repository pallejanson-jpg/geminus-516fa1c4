
# Plan: Fixa XKT-synkronisering till Lovable Cloud

## Problem identifierat
XKT-synkroniseringen misslyckas eftersom edge-funktionen `asset-plus-sync` använder fel URL för 3D API:n.

**Nuvarande (felaktig) URL i sync-funktionen:**
```
https://stage-demo-asset-plus.serviceworksglobal.cloud/api/v1/AssetDB/GetModels?fmGuid=...
```

**Korrekt URL (som används i useXktPreload):**
```
https://stage-demo-asset-plus.serviceworksglobal.cloud/api/threed/GetModels?fmGuid=...
```

## Lösning
Uppdatera `asset-plus-sync/index.ts` för att normalisera API-URL:en på samma sätt som görs i frontend-koden.

## Ändringar

### Fil: `supabase/functions/asset-plus-sync/index.ts`

Ändra rad 568-570 från:
```javascript
// Try to fetch models via GetModels endpoint
const modelsUrl = `${apiUrl?.replace(/\/+$/, "")}/GetModels?fmGuid=${buildingFmGuid}&apiKey=${apiKey}`;
```

Till:
```javascript
// Normalize URL: remove /api/v1/AssetDB if present, use base domain with /api/threed
const baseUrl = apiUrl?.replace(/\/api\/v\d+\/AssetDB\/?$/i, '').replace(/\/+$/, '') || '';
const modelsUrl = `${baseUrl}/api/threed/GetModels?fmGuid=${buildingFmGuid}&apiKey=${apiKey}`;
```

## Validering
Efter ändringen kan vi testa synkroniseringen på nytt för att verifiera att XKT-filerna laddas ner och sparas korrekt.

## Sammanfattning
En enkel URL-fix i edge-funktionen som säkerställer att rätt 3D API-endpoint används för att hämta modellistan.
