
# Alternativa metoder att hämta ACC-projekt

## Bakgrund

403-felet uppstår eftersom Autodesks **Construction Admin API** (`/construction/admin/v1/accounts/.../projects`) kräver att din APS-app (Client ID) har lagts till som **Custom Integration** i ACC Account Admin. Det finns två sätt att komma runt detta utan att ändra inställningarna i Autodesk.

## Lösning: Dubbel strategi

### 1. Alternativt API: Data Management API (automatisk)

Autodesks **Data Management API** (`/project/v1/hubs/b.{accountId}/projects`) har ofta lägre behörighetskrav och kan fungera utan Custom Integration. Edge-funktionen uppdateras så att:

- Den först försöker med **Data Management API** (nyare, ofta enklare behörigheter)
- Om det misslyckas, faller tillbaka på **Construction Admin API** (nuvarande metod)
- Användaren märker ingen skillnad — projektlistan visas oavsett vilken endpoint som lyckades

### 2. Manuell inmatning av projekt-ID (fallback)

I inställnings-UI:t läggs ett textfält till där du kan klistra in ett ACC **projekt-ID** direkt. Detta gör att du kan:

- Kopiera projekt-ID:t från ACC-webbadressen (det GUID som syns i URL:en)
- Hoppa över "Hämta projekt"-steget helt
- Gå direkt till synkronisering

## Ändringar

### Edge Function (`supabase/functions/acc-sync/index.ts`)

- Ny funktion `fetchAccProjectsViaDataManagement(token, accountId, region)` som anropar `/project/v1/hubs/b.{accountId}/projects`
- Uppdatera `list-projects`-aktionen så att den provar Data Management API först och faller tillbaka på Admin API
- Lägga till `data:read account:read` i OAuth-scopen (redan inkluderat)

### Inställnings-UI (`src/components/settings/ApiSettingsModal.tsx`)

- Ny state `manualAccProjectId` för manuellt inmatat projekt-ID
- Textfält med etikett "Eller ange projekt-ID manuellt" placerat under "Hämta projekt"-knappen
- Logik som använder manuellt ID om det är ifyllt, annars dropdown-valet
- Synka-knapparna visas om antingen dropdown eller manuellt fält har ett värde

## Teknisk sammanfattning

```text
Hämta projekt-flöde (uppdaterat):

  "Hämta projekt" klick
         |
         v
  Prova Data Management API
  /project/v1/hubs/b.{id}/projects
         |
    Lyckades? --Ja--> Visa projektlista
         |
        Nej
         |
         v
  Fallback: Admin API
  /construction/admin/v1/accounts/{id}/projects
         |
    Lyckades? --Ja--> Visa projektlista
         |
        Nej
         |
         v
  Visa felmeddelande +
  "Ange projekt-ID manuellt"
```
