
## Diagnos: Rootorsak är ett korrumperat sessionStorage + felaktig API-nyckel i SDK-anropet

### Vad nätverksloggarna bevisar

**Problem 1: `GetModels` GET → 404 (linje 22-25)**
```
GET .../api/threed/GetModels?fmGuid=9baa7a3a...&apiKey=e132b81e... → 404
```
Trots att koden raderades finns detta anrop kvar. Orsak: `sessionStorage` cache innehåller gammal config (`geminus_ap_config`) och tokenet cachas i `geminus_ap_token`. Om `useModelNames`-hooken anropar samma endpoint, eller om sessionStorage innehåller gammalt state, kan det dyka upp här.

**Problem 2: `GetAllRelatedModels` POST → 401 (kritisk)**
```
POST .../GetAllRelatedModels
Headers: Authorization: Bearer eyJ...  (BARA Bearer, ingen apiKey)
Body: {"fmGuids":["9BAA7A3A-..."]}
→ 401
```

Asset+ SDK:n gör detta anrop internt — men tokenet har GILTIGA claims (Admin-roll, rätt tenant-id `d294c6d5-...`). Varför 401?

**JWT-token är utgånget.** Token i nätverksloggen har:
- `iat: 1771514505` = 2026-02-19T**16:01:45**Z
- `exp: 1771514805` = 2026-02-19T**16:06:45**Z (bara 5 minuter livslängd!)

Loggtimestampet för anropet är `16:06:47Z` — **2 sekunder EFTER att tokenet gick ut!**

Token expires at **16:06:45**, request happens at **16:06:47** → 401 Unauthorized är korrekt respons.

### Varför cachat token är problemet

`sessionStorage.getItem('geminus_ap_token')` cachen har en "1 min margin" guard:
```typescript
if (Date.now() < expiresAt - 60000) { // 1 min margin
  accessToken = token;  // Use cached token
}
```

Men backend-tokenet från Asset+ staging-miljön har **bara 5 minuters livslängd** (inte 60 minuter som antaget). Med 1 minuts säkerhetsmarginal används cachad token upp till minut 4 av 5 — men om SDK:n tar >1 sekund att initialisera och modellen inte laddas direkt, hinner token gå ut.

Dessutom: sessionStorage-värdet `expiresAt` sätts till `Date.now() + 55 * 60 * 1000` (55 minuter!) oberoende av hur länge tokenet faktiskt är giltigt. Det innebär att ett 5-minuters-token cachas och används i upp till 55 minuter → **alla requests efter minut 5 returnerar 401**.

### Åtgärdsplan

#### Fix 1 — Rensa sessionStorage-cache och läs token-expiry från JWT

Istället för att anta 55 minuters token-livslängd, läs `exp`-claimet direkt från JWT-payload och använd det faktiska utgångsdatumet minus 30 sekunder säkerhetsmarginal:

```typescript
// Rensa gammal felaktig cache
sessionStorage.removeItem('geminus_ap_token');
sessionStorage.removeItem('geminus_ap_config');

// Läs exp från JWT-payload
function getJwtExpiry(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return (payload.exp * 1000) - 30_000; // 30s safety margin
  } catch {
    return Date.now() + 4 * 60 * 1000; // fallback: 4 min
  }
}

// Cachelag token med korrekt expiry
sessionStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({
  token: accessToken,
  expiresAt: getJwtExpiry(accessToken),  // ← Läs från JWT, inte hårdkodad 55 min
}));
```

#### Fix 2 — Reducera cache-guard från 60 sekunder till 30 sekunder

Med 5-minuterstokens och 60-sekunders guard kastas tokenet efter 4 minuter. Med 30-sekunders guard används det i 4,5 minuter:

```typescript
// BEFORE:
if (Date.now() < expiresAt - 60000) { // 1 min margin

// AFTER:
if (Date.now() < expiresAt - 30000) { // 30s margin (tokens can be short-lived)
```

#### Fix 3 — Rensa sessionStorage vid viewer-init (engångsfix)

Lägg till en rensning av sessionStorage-nycklarna i `initializeViewer` INNAN token-hämtningen:

```typescript
// Clear potentially stale cached token/config on fresh viewer init
// This ensures we always use a fresh token, avoiding 401 from expired cached tokens
const now = Date.now();
const cachedToken = sessionStorage.getItem(TOKEN_CACHE_KEY);
if (cachedToken) {
  try {
    const { expiresAt } = JSON.parse(cachedToken);
    if (now >= expiresAt - 30000) {
      sessionStorage.removeItem(TOKEN_CACHE_KEY); // Expired or near-expiry: force refresh
    }
  } catch {
    sessionStorage.removeItem(TOKEN_CACHE_KEY); // Bad cache: clear
  }
}
```

#### Fix 4 — `getAccessTokenCallback` ska alltid returnera ett färskt token

SDK:n anropar `getAccessTokenCallback` när den behöver ett nytt token. Just nu returnerar den bara `accessTokenRef.current` som sattes vid init. Om SDK:n kallar tillbaka efter 5 minuter returneras ett utgånget token.

Implementera en automatisk token-refresh i callbacken:

```typescript
async () => {
  // Check if cached token is still valid (with 30s margin)
  const cached = sessionStorage.getItem(TOKEN_CACHE_KEY);
  if (cached) {
    try {
      const { token, expiresAt } = JSON.parse(cached);
      if (Date.now() < expiresAt - 30000) {
        accessTokenRef.current = token;
        return token;
      }
    } catch { /* clear bad cache */ }
  }
  
  // Token expired or missing — fetch fresh token
  const { data } = await supabase.functions.invoke('asset-plus-query', {
    body: { action: 'getToken' }
  });
  const freshToken = data?.accessToken;
  if (freshToken) {
    accessTokenRef.current = freshToken;
    sessionStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({
      token: freshToken,
      expiresAt: getJwtExpiry(freshToken),
    }));
  }
  return accessTokenRef.current;
},
```

### Filer som ändras

| Fil | Ändring |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | 1) Lägg till `getJwtExpiry()` hjälpfunktion, 2) Fix token-cache med JWT-baserad expiry, 3) Fix `getAccessTokenCallback` för automatisk token-refresh, 4) Minska cache-guard från 60s till 30s |

Inga edge functions, inga databasändringar, inga nya beroenden.

### Varför detta löser problemet

- Token hämtas alltid med korrekt expiry från JWT-payload
- `getAccessTokenCallback` refreshar automatiskt utgångna tokens under pågående session
- Gamla felaktiga sessionStorage-caches identifieras och rensas vid nästa viewer-init
- SDK:n får alltid ett giltigt token oavsett när den anropar callback
