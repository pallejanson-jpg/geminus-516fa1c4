

## Använd JWT direkt istället för login

Du har helt rätt. Eftersom login-endpointen returnerar 401 men du kan logga in manuellt, kan vi ta en annan approach: lagra JWT:n som en secret och använda den direkt för API-anrop.

### Problem
Login via `/api/users/login` returnerar konsekvent 401 trots korrekta credentials. Kan bero på att endpointen kräver ytterligare headers, CSRF-token, eller annan mekanism som webbläsaren hanterar automatiskt.

### Lösning
1. **Ny secret `SWG_SUPPORT_JWT`** -- du klistrar in JWT:n du får när du loggar in manuellt
2. **Uppdatera `support-proxy/index.ts`** -- använd `SWG_SUPPORT_JWT` direkt i `jwt`-headern, skippa login-anropet helt
3. **Fallback-logik** -- om JWT:n ger 401 (utgången), returnera ett tydligt felmeddelande till frontend som säger "JWT har gått ut, uppdatera i backend secrets"
4. **Frontend** -- visa ett informativt meddelande när JWT:n har gått ut, istället för generiskt fel

### Begränsning
JWT:n har ~10 timmars TTL (`exp - nbf`). Du behöver uppdatera secreten med en ny JWT när den löper ut. Vi kan eventuellt lösa login-problemet senare för att automatisera detta.

### Teknisk detalj
- `login()` ersätts med enkel secret-läsning: `Deno.env.get("SWG_SUPPORT_JWT")`
- `proxyRequest()` fortsätter skicka `jwt`-header som tidigare
- Vid 401-svar från proxy-anrop: returnera `{ error: "jwt_expired" }` som frontend kan hantera

