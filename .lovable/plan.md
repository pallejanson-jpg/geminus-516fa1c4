

# Plan: Fixa Ivion API-autentisering med rätt header

## Problem identifierat

Ivion använder **`x-authorization`** istället för standard `Authorization`-header. Edge-funktionen skickar för närvarande `Authorization: Bearer ...` men borde skicka `x-authorization: Bearer ...`.

## Lösning

### Steg 1: Uppdatera edge-funktionen

Ändra alla API-anrop i `supabase/functions/ivion-poi/index.ts` för att använda `x-authorization` istället för `Authorization`:

```typescript
// FÖRE:
headers: {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json',
}

// EFTER:
headers: {
  'x-authorization': `Bearer ${token}`,
  'Content-Type': 'application/json',
}
```

### Steg 2: Uppdatera autentiseringsmetoder

Eftersom tokenen som visades har `provider: LOCAL` och `sub: SWG_Demo`, verkar det som att username/password-autentisering faktiskt fungerar - men vi behöver använda rätt endpoint och headers för att hämta token.

Uppdatera `attemptAuth`-funktionerna för att:
1. Testa med `x-authorization` header
2. Kontrollera om login-endpointen returnerar token i ett annat format

### Steg 3: Lägg till IVION_ACCESS_TOKEN temporärt

Som en snabb lösning, lägg till den token du hittade som hemlig nyckel:
- **Namn:** IVION_ACCESS_TOKEN  
- **Värde:** `eyJhbGciOiJIUzI1NiJ9.eyJ0eXBlIjoiQVVUSCIsInByb3ZpZGVyIjoiTE9DQUwiLCJ0b2tlblR5cGUiOiJBQ0NFU1MiLCJzdWIiOiJTV0dfRGVtbyIsImV4cCI6MTc2OTc4NDA3NiwiaWF0IjoxNzY5NzgyMjc2fQ.rWbCFPv241SWgadz65d4U90JNkSY-rQbR8pjtLgd__g`

**OBS:** Denna token går ut om ~30 minuter. För långsiktig användning behöver vi automatisk token-förnyelse.

## Filer att ändra

| Fil | Ändringar |
|-----|-----------|
| `supabase/functions/ivion-poi/index.ts` | Byt `Authorization` till `x-authorization` i alla API-anrop |

## Token-information från JWT

```text
{
  "type": "AUTH",
  "provider": "LOCAL",
  "tokenType": "ACCESS",
  "sub": "SWG_Demo",
  "exp": 1769784076,  // Utgår snart
  "iat": 1769782276
}
```

Detta bekräftar att IVION_USERNAME (SWG_Demo) är korrekt - vi använder bara fel header!

## Nästa steg efter implementation

1. Testa "Skapa POI från Geminus"-knappen
2. Verifiera att POIs skapas korrekt i Ivion
3. Implementera automatisk token-förnyelse om username/password fungerar med rätt headers

