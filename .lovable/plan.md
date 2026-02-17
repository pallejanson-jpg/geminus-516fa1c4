
# Senslinc Keycloak/AD-autentisering — analys och lösning

## Nuläge och problemet

Den befintliga `senslinc-query`-funktionen använder `/api-token-auth/` (Django token auth) med email + lösenord lagrade som hemligheter `SENSLINC_EMAIL` och `SENSLINC_PASSWORD`. Dessa hemligheter finns redan konfigurerade.

Problemet du beskriver är att Senslincs miljö använder **Active Directory via Keycloak** som IdP — vilket innebär att vanliga email/lösenord-inloggningen troligen antingen:
1. Inte fungerar alls (blockas med 401/403)
2. Fungerar men är ett AD-konto som kan löpa ut / kräver MFA

## Tre möjliga autentiseringsflöden hos Senslinc

### Variant A: Keycloak `client_credentials` (Service Account) — REKOMMENDERAT
Senslinc-instansen har ett **service account** i Keycloak med `client_id` + `client_secret`. Ingen AD-användare behövs. Token hämtas via Keycloaks token-endpoint:

```
POST {KEYCLOAK_URL}/protocol/openid-connect/token
grant_type=client_credentials
client_id={SENSLINC_CLIENT_ID}
client_secret={SENSLINC_CLIENT_SECRET}
```

→ Returnerar ett JWT `access_token` som sedan skickas till Senslinc API som `Authorization: Bearer {token}` (istället för nuvarande `Authorization: JWT {token}`).

**Förekomst i projektet**: Asset+ och FM Access använder exakt detta mönster — kodmönstret finns redan i `asset-plus-sync/index.ts` och `fm-access-query/index.ts`.

### Variant B: Keycloak `password` grant med AD-konto
Samma som idag men via Keycloak token-endpoint istället för `/api-token-auth/`:

```
POST {KEYCLOAK_URL}/protocol/openid-connect/token
grant_type=password
username={AD_USERNAME}
password={AD_PASSWORD}
client_id={SENSLINC_CLIENT_ID}
```

Tokenformatet ändras till `Bearer` istället för `JWT`.

**Risk**: AD-lösenord löper ut, MFA kan aktiveras, kräver AD-konto.

### Variant C: Hybrid — Senslinc API-token via AD-inloggning
Keycloak bearer-token skickas till Senslincs `/api-token-auth/` som ersätter email/lösenord. Ovanligare men möjligt.

## Vad vi bygger

Uppdatera `senslinc-query` edge function med stöd för **alla tre varianterna** via ett autentiseringsval i hemligheten `SENSLINC_AUTH_MODE`.

### Ny autentiseringslogik

```typescript
// Prioriteringsordning:
// 1. Om SENSLINC_KEYCLOAK_URL finns → Keycloak-flöde (client_credentials eller password)
// 2. Om inget Keycloak → befintlig /api-token-auth/ (bakåtkompatibelt)

async function getToken(apiUrl: string, email: string, password: string): Promise<string> {
  const keycloakUrl = Deno.env.get('SENSLINC_KEYCLOAK_URL');
  const clientId = Deno.env.get('SENSLINC_CLIENT_ID');
  const clientSecret = Deno.env.get('SENSLINC_CLIENT_SECRET');
  
  // Keycloak-flöde
  if (keycloakUrl && clientId) {
    return await getKeycloakToken(keycloakUrl, clientId, clientSecret, email, password);
  }
  
  // Legacy Django token auth (befintlig logik)
  return await getDjangoToken(apiUrl, email, password);
}
```

### Token-header anpassas automatiskt

```typescript
// Nuvarande (Django):
headers: { 'Authorization': `JWT ${token}` }

// Keycloak bearer:
headers: { 'Authorization': `Bearer ${token}` }
```

Auth-läget avgörs av om `SENSLINC_KEYCLOAK_URL` är konfigurerad.

## Nya hemligheter som krävs

Beroende på Senslincs faktiska konfiguration behövs ett av:

| Variant | Hemligheter |
|---|---|
| A: client_credentials (service account) | `SENSLINC_KEYCLOAK_URL`, `SENSLINC_CLIENT_ID`, `SENSLINC_CLIENT_SECRET` |
| B: password grant med AD-konto | `SENSLINC_KEYCLOAK_URL`, `SENSLINC_CLIENT_ID`, `SENSLINC_EMAIL` (AD-user), `SENSLINC_PASSWORD` (AD-pwd) |
| C: Hybrid | Inga nya — befintliga räcker |

`SENSLINC_EMAIL` och `SENSLINC_PASSWORD` finns redan — vid Variant B återanvänds de som AD-konto.

## Teknisk implementation

### `supabase/functions/senslinc-query/index.ts` — uppdateras

Ny `getKeycloakToken`-funktion läggs till (återanvänder mönstret från `asset-plus-sync`):

```typescript
// 55-minuters cache bibehålls
let cachedToken: { token: string; expiresAt: number; type: 'JWT' | 'Bearer' } | null = null;

async function getKeycloakToken(
  keycloakUrl: string,
  clientId: string,
  clientSecret: string | undefined,
  username: string | undefined,
  password: string | undefined
): Promise<{ token: string; type: 'Bearer' }> {
  
  const tokenUrl = keycloakUrl.endsWith('/protocol/openid-connect/token')
    ? keycloakUrl
    : `${keycloakUrl.replace(/\/+$/, '')}/protocol/openid-connect/token`;
  
  const params = new URLSearchParams({ client_id: clientId });
  
  if (clientSecret && !username) {
    // Variant A: client_credentials (service account — föredras)
    params.set('grant_type', 'client_credentials');
    params.set('client_secret', clientSecret);
  } else if (username && password) {
    // Variant B: password grant med AD-konto
    params.set('grant_type', 'password');
    params.set('username', username);
    params.set('password', password);
    if (clientSecret) params.set('client_secret', clientSecret);
  }
  
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Keycloak auth failed: ${response.status} - ${text}`);
  }
  
  const data = await response.json();
  return { token: data.access_token, type: 'Bearer' };
}
```

### Token-typ propageras till API-anrop

```typescript
// senslincFetchWithRetry uppdateras:
async function senslincFetchWithRetry(
  apiUrl: string,
  endpoint: string,
  token: string,
  tokenType: 'JWT' | 'Bearer' = 'JWT',  // ny parameter
  options?: { method?: string; body?: unknown }
): Promise<unknown> {
  // ...
  headers: { 'Authorization': `${tokenType} ${token}` }
}
```

### `test-connection` action uppdateras

Visar vilket autentiseringsläge som används:

```typescript
case 'test-connection': {
  const mode = Deno.env.get('SENSLINC_KEYCLOAK_URL') ? 'Keycloak' : 'Django token';
  const { token, type } = await getTokenWithType(...);
  const sites = await senslincFetch(...);
  return jsonResponse({
    success: true,
    message: `Anslutning lyckades via ${mode}! Hittade ${sites.length} sites.`,
    authMode: mode,
  });
}
```

## Nästa steg — vad vi behöver veta

Jag behöver en sak av dig för att veta exakt vilka hemligheter som ska konfigureras:

**Fråga till dig**: Vet du om Senslinc (InUse) har ett **service account** (client_id + client_secret) i Keycloak, eller om vi måste använda ett vanligt **AD-användarkonto** (username + password via Keycloak)?

Om du har kontakt med Senslinc/InUse-supporten eller din IT-avdelning kan de berätta:
- Finns det ett Keycloak client_id för API-åtkomst?
- Finns det ett service account med client_secret?
- Vilken är Keycloak-instansens URL (`/realms/{realm}/...`)?

## Vad som förändras

| Komponent | Förändring |
|---|---|
| `senslinc-query/index.ts` | Ny `getKeycloakToken()`, token-typ propageras, `test-connection` visar auth-läge |
| Hemligheter | `SENSLINC_KEYCLOAK_URL`, `SENSLINC_CLIENT_ID`, ev. `SENSLINC_CLIENT_SECRET` |
| Befintliga hemligheter | `SENSLINC_EMAIL` / `SENSLINC_PASSWORD` bibehålls (Keycloak password grant eller legacy fallback) |
| Token-header | Automatiskt `JWT` (legacy) eller `Bearer` (Keycloak) beroende på konfiguration |

## Bakåtkompatibilitet

Om `SENSLINC_KEYCLOAK_URL` inte är satt → **exakt samma beteende som idag**. Ingen funktionsförändring för befintliga miljöer.

## Vad vi implementerar nu

Uppdaterar `senslinc-query` edge function med det kompletta Keycloak-stödet (alla tre varianterna). Konfigurationen sker via hemligheter utan kodändringar.

