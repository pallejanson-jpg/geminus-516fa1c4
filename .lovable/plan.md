

# Automatisk NavVis IVION Token-hämtning

## Sammanfattning

Du har helt rätt! NavVis IVION stödjer direkt API-inloggning med username/password via `/api/auth/generate_tokens` endpoint - precis som Asset+. Du har redan `IVION_USERNAME` och `IVION_PASSWORD` konfigurerade som secrets, så vi behöver bara uppdatera edge functions för att använda dem.

## Vad NavVis API-dokumentationen säger

Enligt officiella NavVis IVION API-specifikationen (v11.9.7):

```
POST /api/auth/generate_tokens
Content-Type: application/json

{
  "username": "accountant",
  "password": "kr$v[(m@V'pBN?2A"
}

Response:
{
  "access_token": "eyJhbGci...",
  "refresh_token": "eyJhbGci...",
  "upload_token": "eyJhbGci...",
  "principal": { ... }
}
```

Detta betyder att vi kan automatiskt hämta tokens utan manuell inloggning!

## Planerade ändringar

### Fil: `supabase/functions/ai-asset-detection/index.ts`

Uppdatera `getIvionToken()` funktionen för att:

1. Först försöka använda cached token (om giltig)
2. Om access token utgått → försök refresh med refresh token
3. Om refresh misslyckas → logga in med username/password via `/api/auth/generate_tokens`
4. Cacha den nya token för efterföljande anrop

| Ändring | Beskrivning |
|---------|-------------|
| Lägg till `IVION_USERNAME` och `IVION_PASSWORD` läsning | Hämta credentials från secrets |
| Ny inloggningslogik | POST till `/api/auth/generate_tokens` med username/password |
| Uppdatera felhantering | Tydligare felmeddelanden om credentials saknas |

### Teknisk implementation

```typescript
// Environment - lägg till username/password
const IVION_USERNAME = (Deno.env.get('IVION_USERNAME') || '').trim();
const IVION_PASSWORD = (Deno.env.get('IVION_PASSWORD') || '').trim();

async function getIvionToken(): Promise<string> {
  // 1. Check cached token
  if (cachedToken && !isTokenExpired(cachedToken)) {
    return cachedToken;
  }
  
  // 2. Try existing access token
  if (IVION_ACCESS_TOKEN && !isTokenExpired(IVION_ACCESS_TOKEN)) {
    return IVION_ACCESS_TOKEN;
  }
  
  // 3. Try refresh token
  if (IVION_REFRESH_TOKEN) {
    // ... existing refresh logic ...
  }
  
  // 4. NEW: Login with username/password
  if (IVION_USERNAME && IVION_PASSWORD) {
    console.log('Attempting login with username/password...');
    const loginResponse = await fetch(`${IVION_API_URL}/api/auth/generate_tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        username: IVION_USERNAME,
        password: IVION_PASSWORD,
      }),
    });
    
    if (loginResponse.ok) {
      const data = await loginResponse.json();
      if (data.access_token) {
        cachedToken = data.access_token;
        return data.access_token;
      }
    }
  }
  
  throw new Error('Could not authenticate with Ivion');
}
```

## Fördelar

| Före | Efter |
|------|-------|
| Manuell token-extraktion från webbläsaren var ~15:e minut (access token) eller 7 dagar (refresh token) | Helt automatisk autentisering - tokens hämtas och förnyas automatiskt |
| Fel: "Ivion access token expired" | Automatisk re-autentisering vid token-utgång |

## Sammanfattning av filändringar

| Fil | Ändring |
|-----|---------|
| `supabase/functions/ai-asset-detection/index.ts` | Lägg till username/password login via `/api/auth/generate_tokens` |

## Viktigt

Denna funktion fungerar **endast** för lokala användarkonton i NavVis IVION (provider = "LOCAL"). Om er IVION-instans använder SSO/OAuth (Azure AD, OIDC, etc.) så krävs fortfarande manuell token-hämtning via mandatflödet.

