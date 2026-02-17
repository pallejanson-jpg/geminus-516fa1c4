
# Senslinc Keycloak-stöd — implementation

## Nuläge (bekräftat)

`test-connection`-knappen i Settings fungerar idag — det innebär att `SENSLINC_EMAIL` + `SENSLINC_PASSWORD` autentiserar mot Senslincs `/api-token-auth/`-endpoint just nu. Troligen ett lokalt servicekonto i Senslinc-instansen.

Problemet uppstår när/om Senslinc migrerar kontot till AD via Keycloak — då slutar Django-token-authen fungera och vi behöver Keycloak OAuth2.

## Vad som ändras

En enda fil ändras: `supabase/functions/senslinc-query/index.ts`.

### Prioritetsordning för autentisering

```
1. SENSLINC_KEYCLOAK_URL finns + SENSLINC_CLIENT_ID finns
   → Keycloak client_credentials (service account) — Variant A
   → Keycloak password grant med SENSLINC_EMAIL/PASSWORD — Variant B (fallback)

2. SENSLINC_KEYCLOAK_URL finns INTE
   → Befintlig Django /api-token-auth/ — exakt som idag
```

### Token-cache uppdateras

Nuvarande cache:
```typescript
let cachedToken: { token: string; expiresAt: number } | null = null;
```

Ny cache (lägger till `type`):
```typescript
let cachedToken: { token: string; expiresAt: number; type: 'JWT' | 'Bearer' } | null = null;
```

### Ny `getTokenWithType()`-funktion

Ersätter befintliga `getJwtToken()` (som behålls för bakåtkompatibilitet men delegerar till den nya):

```typescript
async function getTokenWithType(
  apiUrl: string, email: string, password: string
): Promise<{ token: string; type: 'JWT' | 'Bearer' }> {
  
  // Check cache
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return { token: cachedToken.token, type: cachedToken.type };
  }
  
  const keycloakUrl = Deno.env.get('SENSLINC_KEYCLOAK_URL');
  const clientId = Deno.env.get('SENSLINC_CLIENT_ID');
  const clientSecret = Deno.env.get('SENSLINC_CLIENT_SECRET');
  
  if (keycloakUrl && clientId) {
    // Variant A: client_credentials (service account, inget AD-konto behövs)
    // Variant B: password grant med AD-konto (om client_credentials misslyckas)
    const result = await getKeycloakToken(keycloakUrl, clientId, clientSecret, email, password);
    cachedToken = { ...result, expiresAt: Date.now() + TOKEN_TTL_MS };
    return result;
  }
  
  // Legacy: Django /api-token-auth/ (nuvarande beteende)
  const token = await getDjangoToken(apiUrl, email, password);
  cachedToken = { token, type: 'JWT', expiresAt: Date.now() + TOKEN_TTL_MS };
  return { token, type: 'JWT' };
}
```

### `getKeycloakToken()` — ny funktion

```typescript
async function getKeycloakToken(
  keycloakUrl: string, clientId: string,
  clientSecret: string | undefined,
  username: string | undefined, password: string | undefined
): Promise<{ token: string; type: 'Bearer' }> {
  
  const tokenUrl = keycloakUrl.includes('/protocol/openid-connect/token')
    ? keycloakUrl
    : `${keycloakUrl.replace(/\/+$/, '')}/protocol/openid-connect/token`;
  
  // Försök 1: client_credentials (service account)
  if (clientSecret) {
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (res.ok) {
      const data = await res.json();
      return { token: data.access_token, type: 'Bearer' };
    }
    // Om client_credentials misslyckas → försök password grant
  }
  
  // Försök 2: password grant med AD-konto
  if (username && password) {
    const params = new URLSearchParams({
      grant_type: 'password',
      client_id: clientId,
      username,
      password,
    });
    if (clientSecret) params.set('client_secret', clientSecret);
    
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Keycloak auth failed: ${res.status} - ${text}`);
    }
    const data = await res.json();
    return { token: data.access_token, type: 'Bearer' };
  }
  
  throw new Error('Keycloak: varken client_secret eller username/password finns');
}
```

### `senslincFetchWithRetry` uppdateras

Lägger till `tokenType`-parameter:

```typescript
async function senslincFetchWithRetry(
  apiUrl: string, endpoint: string, token: string,
  tokenType: 'JWT' | 'Bearer' = 'JWT',   // ← ny parameter
  options?: { method?: string; body?: unknown }
): Promise<unknown> {
  // ...
  headers: { 
    'Authorization': `${tokenType} ${token}`,  // ← dynamisk typ
    'Content-Type': 'application/json',
  }
}
```

### `test-connection` uppdateras

Visar vilket auth-läge som används och fungerar som diagnostikverktyg:

```typescript
case 'test-connection': {
  const authMode = Deno.env.get('SENSLINC_KEYCLOAK_URL') ? 'Keycloak' : 'Django token';
  const { token, type } = await getTokenWithType(cleanApiUrl, email, password);
  const sites = await senslincFetchWithRetry(cleanApiUrl, '/api/sites', token, type);
  return jsonResponse({
    success: true,
    message: `Anslutning lyckades via ${authMode}! Hittade ${Array.isArray(sites) ? sites.length : 0} sites.`,
    authMode,
  });
}
```

## Bakåtkompatibilitet

- Om `SENSLINC_KEYCLOAK_URL` **inte är satt**: exakt samma beteende som idag — `/api-token-auth/` med `JWT`-header. Ingen förändring.
- Om `SENSLINC_KEYCLOAK_URL` **är satt**: Keycloak-flödet aktiveras med `Bearer`-header.
- Befintliga hemligheter `SENSLINC_EMAIL` och `SENSLINC_PASSWORD` används i båda fallen.

## Nya hemligheter (konfigureras när du fått dem från Senslinc)

| Hemlighet | Krävs för |
|---|---|
| `SENSLINC_KEYCLOAK_URL` | Aktiverar Keycloak-flödet (t.ex. `https://auth.inuse.se/realms/senslinc`) |
| `SENSLINC_CLIENT_ID` | Keycloak client-id för Senslinc-applikationen |
| `SENSLINC_CLIENT_SECRET` | Service account-secret (Variant A) — valfri om Variant B används |

Utan dessa → befintlig inloggning fortsätter fungera.

## Vad som ändras

| Fil | Ändring |
|---|---|
| `supabase/functions/senslinc-query/index.ts` | Ny `getTokenWithType()`, `getKeycloakToken()`, dynamisk token-header i `senslincFetchWithRetry`, uppdaterad `test-connection` |

Inga frontend-ändringar. Inga DB-migrationer. Inga nya edge functions.
