

# Plan: Automatisera Ivion-inloggning för AI-skanning

## Sammanfattning

Istället för att du ska klistra in tokens manuellt kommer systemet att:
1. **Logga in automatiskt** med username/password när AI-skanningen startar
2. **Spara tokens i databasen** så att de kan förnyas automatiskt
3. **Förnya automatiskt** när tokens håller på att gå ut
4. **Visa tydlig status** om något går fel

Du behöver aldrig röra F12, tokens eller liknande igen.

## Arkitektur

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                    AI SCAN STARTS                                       │
│                         │                                               │
│                         ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  1. Check building_settings for stored tokens                       ││
│  │     └── ivion_access_token, ivion_refresh_token, expires_at         ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                         │                                               │
│        ┌────────────────┼────────────────┐                              │
│        │                │                │                              │
│        ▼                ▼                ▼                              │
│   Token valid?      Token expired?   No token?                          │
│        │                │                │                              │
│        ▼                ▼                ▼                              │
│    Use token    Use refresh_token   Login with                          │
│                  to get new one     username/password                   │
│        │                │                │                              │
│        └────────────────┼────────────────┘                              │
│                         │                                               │
│                         ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  2. Save new tokens to building_settings (database)                 ││
│  │     → access_token, refresh_token, expires_at                       ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                         │                                               │
│                         ▼                                               │
│                 3. Continue with scan                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Ändringar

### 1. Utöka `building_settings`-tabellen

Lägg till tre nya kolumner för att lagra tokens per byggnad:

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| `ivion_access_token` | text | JWT access token (~30 min) |
| `ivion_refresh_token` | text | Refresh token (~7 dagar) |
| `ivion_token_expires_at` | timestamptz | När access_token går ut |

### 2. Uppdatera `getIvionToken()` i edge functions

Ny prioritetsordning för att hämta token:

```text
1. Check building_settings in database
   └── If valid access_token exists → use it
   └── If expired but refresh_token exists → refresh and save new tokens
   
2. Fallback to IVION_USERNAME/PASSWORD from secrets
   └── Login via /api/auth/generate_tokens
   └── Save both tokens to building_settings
   
3. Last resort: use IVION_ACCESS_TOKEN from secrets (legacy)
```

Tokenerna sparas nu tillbaka till databasen efter varje förnyelse, så nästa anrop använder den sparade versionen.

### 3. Förenkla IvionConnectionModal

Byt från "klistra in token" till ett enkelt formulär:

```text
┌─────────────────────────────────────────────┐
│      Connect to NavVis IVION                │
├─────────────────────────────────────────────┤
│                                             │
│  Credentials are already configured.        │
│  Click Test to verify the connection.       │
│                                             │
│  Username: SWG_***                          │
│  Instance: swg.iv.navvis.com                │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │       Test Connection               │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Status: ✓ Connected (token valid 25 min)   │
│                                             │
└─────────────────────────────────────────────┘
```

Användaren behöver bara klicka "Test" för att verifiera att konfigurationen fungerar.

### 4. Automatisk reconnect vid AI-skanning

I `ai-asset-detection/index.ts`:

**Före skanning startar:**
1. Anropa `getIvionToken(buildingFmGuid)` som nu inkluderar auto-login
2. Om det lyckas → fortsätt med skanning
3. Om det misslyckas → returnera tydligt felmeddelande till UI

**I UI (`ScanConfigPanel.tsx`):**
- Visa Ivion-status innan användaren startar skanning
- "Ivion connected ✓" eller "Ivion: authentication required"

## Filer att ändra

| Fil | Åtgärd | Beskrivning |
|-----|--------|-------------|
| `supabase/migrations/` | Skapa | Lägg till token-kolumner i building_settings |
| `supabase/functions/ivion-poi/index.ts` | Ändra | Uppdatera getIvionToken() för db-lagring |
| `supabase/functions/ai-asset-detection/index.ts` | Ändra | Uppdatera getIvionToken() för db-lagring |
| `src/components/settings/IvionConnectionModal.tsx` | Förenkla | Visa status istället för token-input |
| `src/components/ai-scan/ScanConfigPanel.tsx` | Ändra | Visa Ivion-anslutningsstatus |

## Tekniska detaljer

### Token-flödet i detalj

```text
getIvionToken(buildingFmGuid):
  
  1. Query building_settings for this building
     
  2. IF ivion_access_token exists AND not expired:
       → Return access_token (fastest path)
     
  3. ELSE IF ivion_refresh_token exists:
       → POST /api/auth/refresh_access_token
       → Save new access_token + refresh_token to DB
       → Return new access_token
     
  4. ELSE IF IVION_USERNAME + IVION_PASSWORD in secrets:
       → POST /api/auth/generate_tokens
       → Save access_token + refresh_token to DB
       → Return access_token
     
  5. ELSE IF IVION_ACCESS_TOKEN in secrets (legacy):
       → Return if not expired
     
  6. ELSE:
       → Throw error: "Ivion not configured"
```

### Databasuppdatering efter login

```sql
UPDATE building_settings 
SET 
  ivion_access_token = 'eyJ...',
  ivion_refresh_token = 'eyJ...',
  ivion_token_expires_at = '2026-02-03T12:30:00Z'
WHERE fm_guid = 'building-uuid';
```

## Resultat

Efter implementationen:

1. **Du konfigurerar en gång:** Username/password i Cloud secrets (redan gjort!)
2. **Första AI-skanningen:** Systemet loggar in automatiskt och sparar tokens
3. **Efterföljande skanningar:** Systemet använder sparade tokens
4. **Tokens går ut:** Systemet förnyar automatiskt med refresh_token
5. **Refresh_token går ut (efter ~7 dagar):** Systemet loggar in igen automatiskt med username/password

Du behöver aldrig röra tokens manuellt igen.

