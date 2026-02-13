

## Fix FM Access Authentication Headers

### Problem
FM Access (Tessel HDC API) kräver `X-Authorization` som auth-header, inte standard `Authorization`. Vår edge function skickar fel header, vilket orsakar 401-felet på `/api/systeminfo/json`.

### Dokumentationens krav
Enligt Tessels officiella dokumentation:
- Token-anrop till Keycloak använder standard OAuth2 (detta fungerar redan)
- API-anrop till HDC-systemet kräver **`X-Authorization: Bearer <token>`**
- API-anrop kräver också **`X-Hdc-Version-Id: <versionId>`**
- Version-ID hämtas från `GET /api/systeminfo/json` och finns i svaret som `defaultVersion.versionId`

### Ändringar i `supabase/functions/fm-access-query/index.ts`

1. **`getVersionId` funktion** -- Byt `Authorization` till `X-Authorization` i headern vid anrop till `/api/systeminfo/json`. Extrahera version-ID från `data.defaultVersion.versionId` (inte `data.versionId`).

2. **`fmAccessFetch` funktion** -- Byt `Authorization` till `X-Authorization` i headern för alla API-anrop.

3. **Testa anslutningen** -- Kör `test-connection` igen för att verifiera att vi nu får tillbaka systeminfo och versionId korrekt.

### Teknisk detalj

```text
Nuvarande (felaktigt):
  headers: { 'Authorization': 'Bearer <token>' }

Nytt (korrekt enligt Tessel-dokumentation):
  headers: { 'X-Authorization': 'Bearer <token>' }

Version-ID extraction:
  Nuvarande: data.versionId || data.id || data.version || data.systemVersion
  Nytt:      data.defaultVersion?.versionId || data.defaultVersion?.defaultVersionId
```

### Steg
1. Uppdatera `getVersionId` -- byt auth-header och version-ID-extrahering
2. Uppdatera `fmAccessFetch` -- byt auth-header
3. Deploya edge function
4. Testa med `test-connection` action
5. Spara dokumentationen i `docs/api/fm-access/` för framtida referens

