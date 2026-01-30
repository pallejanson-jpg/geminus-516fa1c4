

# Plan: Slutför Ivion API-autentisering

## Status

Du har hittat rätt token! Nu behöver vi:
1. Lägga till token som hemlig nyckel för omedelbar användning
2. Uppdatera login-metoderna att använda `x-authorization` för automatisk token-förnyelse

## Steg 1: Lägg till IVION_ACCESS_TOKEN

Lägg till den hämtade JWT-token som hemlig nyckel för omedelbar funktion:
- **Namn:** IVION_ACCESS_TOKEN
- **Värde:** `eyJhbGciOiJIUzI1NiJ9.eyJ0eXBlIjoiQVVUSCIsInByb3ZpZGVyIjoiTE9DQUwiLCJ0b2tlblR5cGUiOiJBQ0NFU1MiLCJzdWIiOiJTV0dfRGVtbyIsImV4cCI6MTc2OTc4NDk5MiwiaWF0IjoxNzY5NzgzMTkyfQ.6kSsIo54Xp9ID-zKsjgeiorFforTDgtOYGxn00kydsk`

## Steg 2: Uppdatera login-metoder för automatisk förnyelse

Ändra auth-metoderna i edge-funktionen att använda `x-authorization` header istället för `Authorization`:

| Metod | Ändring |
|-------|---------|
| Method 3 (Basic Auth) | `Authorization: Basic ...` → `x-authorization: Basic ...` |

Dessutom lägga till en ny auth-metod som testar `/api/auth/local` endpoint som NavVis ibland använder.

## Steg 3: Deploya och testa

1. Edge-funktionen deployeras automatiskt
2. Testa "Skapa POI från Geminus"-knappen
3. Verifiera att POIs skapas korrekt i Ivion

## Teknisk sammanfattning

| Fil | Ändringar |
|-----|-----------|
| `supabase/functions/ivion-poi/index.ts` | Uppdatera login-metoder med `x-authorization` header |
| Secrets | Lägg till `IVION_ACCESS_TOKEN` |

## Viktigt om token-livstid

Tokenen du hämtade utgår om ~30 minuter. Efter att automatisk förnyelse fungerar kommer edge-funktionen att hämta nya tokens automatiskt via username/password. Tills dess behöver tokenen uppdateras manuellt om den går ut.

