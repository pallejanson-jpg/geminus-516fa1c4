

## Fix FM Access: Rätt API-URL och client_secret-stöd

### Orsak till problemet
FM Access API-URL:en är satt till `https://landlord.bim.cloud`, men den korrekta instansen är `https://swg-demo.bim.cloud`. Keycloak-realmen `swg_demo` genererar tokens som bara accepteras av `swg-demo.bim.cloud`-instansen -- det är därför vi får "Didn't find publicKey for specified kid".

### Steg

**1. Uppdatera FM_ACCESS_API_URL**
Ändra secreten `FM_ACCESS_API_URL` från `https://landlord.bim.cloud` till `https://swg-demo.bim.cloud`.

**2. Lägg till stöd för client_secret i edge function**
Enligt Tessels dokumentation kan klienten vara av typen "Confidential" och kräva en `client_secret` i token-anropet. Vi lägger till:
- Ny secret: `FM_ACCESS_CLIENT_SECRET` (om en secret behövs)
- Uppdatera `getToken()` i `supabase/functions/fm-access-query/index.ts` så att `client_secret` skickas med i token-requesten om den finns konfigurerad

**3. Testa anslutningen**
Kör `test-connection` för att verifiera att:
- Token hämtas korrekt
- `/api/systeminfo/json` returnerar version-ID
- Hela flödet fungerar

### Teknisk detalj

```text
Ändring i getToken():
  Nuvarande body:
    grant_type=password&client_id=...&username=...&password=...
  
  Ny body (om client_secret finns):
    grant_type=password&client_id=...&client_secret=...&username=...&password=...

Secret-ändring:
  FM_ACCESS_API_URL: https://landlord.bim.cloud  -->  https://swg-demo.bim.cloud
```

