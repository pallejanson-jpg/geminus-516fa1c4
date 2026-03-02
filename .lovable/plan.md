

## SWG Kundportal API-integration

### Sammanfattning
Bygga en `support-proxy` edge function som autentiserar mot SWGs kundportal (`https://support.serviceworksglobal.se/api/`) och proxar supportärende-anrop -- samma mönster som `errorreport-proxy` använder för felanmälan.

### Vad vi vet
- Portalen är en Angular-app (DevExtreme) med e-post/lösenord-login
- API-endpoint: `GET /api/requests?filter={...}` returnerar ärenden (200 OK efter inloggning, 401 utan)
- Statusar: New, UnderReview, AwaitingResponse, AwaitingOrder, Planned, InProgress, Done, Completed, Closed
- Headern `realm` och `Expression` skickas med requests -- troligtvis auth-token

### Steg 1: Lagra credentials (secrets)
Tre nya secrets behövs:
- `SWG_SUPPORT_URL` = `https://support.serviceworksglobal.se`
- `SWG_SUPPORT_USERNAME` = din e-postadress till portalen
- `SWG_SUPPORT_PASSWORD` = ditt lösenord till portalen

### Steg 2: Skapa edge function `support-proxy`
Ny fil: `supabase/functions/support-proxy/index.ts`

Actions:
- **`login`** -- POST till `/api/auth/login` (eller liknande) med credentials, returnera/cacha auth-token
- **`list-requests`** -- GET `/api/requests?filter={...}` med auth-header, returnera ärendelistan  
- **`get-request`** -- GET `/api/requests/{id}` för att hämta detaljer på ett specifikt ärende
- **`create-request`** -- POST `/api/requests` för att skapa nytt ärende
- **`add-comment`** -- POST kommentar till ett ärende

Proxy:n testar login-endpointen och loggar svaret så vi kan se exakt vilken auth-mekanism som används (cookie, bearer token, eller `realm`/`Expression` headers).

### Steg 3: Uppdatera config.toml
Lägg till `[functions.support-proxy]` med `verify_jwt = false`.

### Steg 4: Uppdatera frontend

**SupportCaseList.tsx:**
- Hämta ärenden via `support-proxy` (action: `list-requests`) istället för lokala `support_cases`-tabellen
- Mappa SWG-statusar (New, UnderReview, etc.) till befintliga svenska etiketter
- Behåll sökfunktion och statusfiltrering

**CreateSupportCase.tsx:**
- Skicka nya ärenden via `support-proxy` (action: `create-request`) till SWG-backend
- Behåll samtidig lokal kopia i `support_cases`-tabellen för offline/historik

**SupportCaseDetail.tsx:**
- Hämta kommentarer från SWG via proxy
- Skicka nya kommentarer till SWG via proxy

### Steg 5: API-inställningar
Lägg till SWG Support-sektion i API Settings (Sync-tab) för att testa anslutningen och visa status.

### Approach: Stegvis
Eftersom vi inte vet exakt vilka endpoints login använder, börjar vi med att skapa edge function som testar `/api/auth/login`, `/api/login`, och `/api/account/login` och loggar svaren. Sedan anpassar vi baserat på resultaten.

