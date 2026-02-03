

# Plan: Implementera NavVis IVION Mandate-baserad Autentisering

## Sammanfattning

NavVis IVION använder ett **interaktivt OAuth-liknande flöde** där användaren måste godkänna en "mandate" i webbläsaren. Detta skiljer sig från traditionell username/password-autentisering och kräver att vi bygger ett UI-flöde för att:

1. Starta autentiseringsprocessen (backend)
2. Visa ett popup/fönster där användaren godkänner (frontend)
3. Polla tills mandatet är godkänt (backend)
4. Byta mandatet mot tokens och spara dem (backend)

## Arkitektur

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                            FRONTEND (React)                             │
├─────────────────────────────────────────────────────────────────────────┤
│  1. Användare klickar "Anslut till Ivion"                               │
│  2. Öppnar popup med NavVis authorization URL                           │
│  3. Användare godkänner i popup                                         │
│  4. Stänger popup, frontend pollar status                               │
│  5. Visar "Ansluten!" när tokens är sparade                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         EDGE FUNCTION (ivion-poi)                       │
├─────────────────────────────────────────────────────────────────────────┤
│  action: 'mandate-request'                                              │
│    → POST /api/auth/mandate/request                                     │
│    → Returnerar authorization_token + authorization_url                 │
│                                                                         │
│  action: 'mandate-validate'                                             │
│    → GET /api/auth/mandate/validate?authorization_token=...             │
│    → Returnerar status: 'pending' | 'authorized' | 'expired'            │
│                                                                         │
│  action: 'mandate-exchange'                                             │
│    → POST /api/auth/mandate/exchange (med exchange_token)               │
│    → Sparar access_token + refresh_token till databasen                 │
│    → Returnerar success + tokenPreview                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Ändringar

### 1. Edge Function: Nya mandate-actions (ivion-poi/index.ts)

Lägg till tre nya actions i edge function:

| Action | Endpoint | Beskrivning |
|--------|----------|-------------|
| `mandate-request` | `POST /api/auth/mandate/request` | Startar autentiseringsflödet, returnerar URL för användaren |
| `mandate-validate` | `GET /api/auth/mandate/validate` | Pollar status för mandatet |
| `mandate-exchange` | `POST /api/auth/mandate/exchange` | Byter mandatet mot tokens |

**Ny funktion: `requestMandate()`**
- Anropar `/api/auth/mandate/request`
- Returnerar `authorization_token`, `exchange_token`, och `authorization_url`

**Ny funktion: `validateMandate(authToken)`**
- Pollar `/api/auth/mandate/validate?authorization_token={authToken}`
- Returnerar `{ authorized: boolean, expired: boolean }`

**Ny funktion: `exchangeMandate(exchangeToken)`**
- Anropar `/api/auth/mandate/exchange` med exchange_token
- Returnerar `access_token` och `refresh_token`

### 2. Databaslagring av tokens (valfritt men rekommenderat)

Alternativ A: **Spara tokens i `building_settings`-tabellen**
- Lägg till kolumner: `ivion_access_token`, `ivion_refresh_token`, `ivion_token_expires_at`
- Tokens är per-site/building

Alternativ B: **Fortsätt använda secrets (nuvarande)**
- Kräver manuell uppdatering vid token-förnyelse
- Enklare implementation

**Rekommendation:** Alternativ A för långsiktig stabilitet, men vi kan börja med Alternativ B och lägga till databaslagring senare.

### 3. Frontend: Ivion Connection Modal (ny komponent)

**Ny fil: `src/components/settings/IvionConnectionModal.tsx`**

```text
┌─────────────────────────────────────────────┐
│         Anslut till NavVis IVION            │
├─────────────────────────────────────────────┤
│                                             │
│  Klicka på knappen nedan för att öppna      │
│  NavVis IVION och godkänna anslutningen.    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │   🔗  Öppna NavVis för godkännande  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Status: ⏳ Väntar på godkännande...        │
│                                             │
│  ┌─────────┐  ┌─────────┐                   │
│  │ Avbryt  │  │  Klar   │                   │
│  └─────────┘  └─────────┘                   │
└─────────────────────────────────────────────┘
```

Steg i flödet:
1. Visa modal med "Öppna NavVis"-knapp
2. När användaren klickar: anropa `mandate-request`, öppna popup med `authorization_url`
3. Starta polling (var 2 sek) mot `mandate-validate`
4. När `authorized: true`: anropa `mandate-exchange`
5. Visa "Ansluten!" och stäng modal

### 4. Integration i API Settings

**Fil: `src/components/settings/ApiSettingsModal.tsx`**

Lägg till en "Anslut"-knapp i Ivion-sektionen som öppnar `IvionConnectionModal`:

```text
┌─────────────────────────────────────────────┐
│  360+ (Ivion)                               │
├─────────────────────────────────────────────┤
│  API URL:  [https://swg.iv.navvis.com    ]  │
│                                             │
│  Status: ❌ Ej ansluten                     │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │  🔗  Anslut med NavVis OAuth          │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## Tekniska detaljer

### NavVis Mandate API-flöde

```text
1. POST /api/auth/mandate/request
   Response: {
     authorization_token: "abc123",
     exchange_token: "xyz789",
     authorization_url: "https://swg.iv.navvis.com/oauth/authorize?token=abc123"
   }

2. Användaren öppnar authorization_url i popup
   → Loggar in på NavVis (om inte redan inloggad)
   → Klickar "Allow" för att godkänna mandatet

3. GET /api/auth/mandate/validate?authorization_token=abc123
   Response: {
     authorized: true,
     expired: false
   }

4. POST /api/auth/mandate/exchange
   Body: { exchange_token: "xyz789" }
   Response: {
     access_token: "eyJ...",
     refresh_token: "eyJ...",
     principal: { username: "SWG_RC", ... }
   }
```

### Token-hantering efter anslutning

- **Access token**: Cachas i edge function-minnet (~30 min)
- **Refresh token**: Sparas i secrets för automatisk förnyelse (~7 dagar)
- **Befintlig `getIvionToken()`**: Fortsätter fungera som tidigare men använder nya tokens

## Filer att ändra/skapa

| Fil | Åtgärd | Beskrivning |
|-----|--------|-------------|
| `supabase/functions/ivion-poi/index.ts` | Ändra | Lägg till mandate-request/validate/exchange actions |
| `src/components/settings/IvionConnectionModal.tsx` | Skapa | Ny modal för OAuth-flöde |
| `src/components/settings/ApiSettingsModal.tsx` | Ändra | Lägg till "Anslut"-knapp för Ivion |

## Fördelar med denna lösning

1. **Fungerar med SSO/OAuth-instanser** - Ingen lokal autentisering krävs
2. **Användarvänligt** - Visuellt flöde med tydlig feedback
3. **Säkert** - Tokens hanteras via popup, aldrig exponerade i URL
4. **Återanvändbart** - Refresh token möjliggör automatisk förnyelse i 7 dagar

## Begränsningar

- Kräver att användaren har ett NavVis-konto med rätt behörigheter
- Refresh token måste förnyas manuellt var 7:e dag (eller automatiseras med schemalagt jobb)
- Popup-blockerare kan störa flödet

