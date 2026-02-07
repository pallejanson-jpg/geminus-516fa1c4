
# Fixa ACC-mappbrowsning (404-fel) och förbättra diagnostik

## Sammanfattning

Tre problem har identifierats. Bara ett av dem (nr 3) kräver en kodfix -- de andra fungerar korrekt men ACC-projektet har begränsad data.

## Problem och lösningar

### Problem 1: "Synkronisera platser" visar 0 byggnader
**Status:** Fungerar korrekt -- ACC-projektet saknar Location-data.
**Atergsrd:** Forbattra UI-feedbacken sa att anvandaren forstar varfor det ar 0, istallet for att bara visa "Synkade 0 platser".

### Problem 2: "Synkronisera tillgangar" visar 1 tillgang
**Status:** Fungerar korrekt -- det finns bara 1 tillgang i ACC.
**Atgard:** Ingen fix kravs.

### Problem 3: "Visa mappar" ger 404-fel
**Status:** Bugg i koden -- fel URL-format for Autodesks Data Management API.

**Orsak:** Koden anropar:
```text
/data/v1/projects/b.{projectId}/topFolders
```
Men korrekt endpoint (enligt Autodesks dokumentation) ar:
```text
/project/v1/hubs/b.{accountId}/projects/b.{projectId}/topFolders
```
Skillnaden:
- Fel bassokvag (`/data/v1/` istallet for `/project/v1/`)
- Hub-ID (`b.{accountId}`) saknas i URL:en

**Fix:** Andra rad 848 i `supabase/functions/acc-sync/index.ts` fran:
```text
const topFoldersUrl = `.../data/v1/projects/${fullProjectId}/topFolders`
```
till:
```text
const topFoldersUrl = `.../project/v1/hubs/${hubId}/projects/${fullProjectId}/topFolders`
```
Variabeln `hubId` beraknas redan korrekt pa rad 842.

---

## Andringslista

### Fil 1: `supabase/functions/acc-sync/index.ts`

1. **Fixa topFolders-URL (rad 848):** Andra fran `/data/v1/projects/...` till `/project/v1/hubs/{hubId}/projects/.../topFolders`
2. **Fixa folderContents-URL (rad 888):** Samma andring for undermappars innehall -- byt fran `/data/v1/projects/...` till `/project/v1/hubs/{hubId}/projects/.../folders/{folderId}/contents` (OBS: Undersoka om contents-endpointen ocksa kräver hub-ID eller om den bara behover `project_id`)
3. **Forbattra sync-locations-feedback:** Nar `totalNodes === 1` och inga barn finns, returnera ett tydligt meddelande: "ACC-projektet har inga platser konfigurerade (bara root-nod). Platsdata kan finnas i BIM-modellerna istallet -- prova 'Visa mappar'."

### Fil 2: `src/components/settings/ApiSettingsModal.tsx`

4. **Forbattra feedback for tomma synkresultat:** Visa en informativ banner nar sync-locations returnerar 0 byggnader, med en hanvisning till "Visa mappar" som alternativ datakalla.

---

## Tekniska detaljer

### Korrekt URL-format for Data Management API

Alla Data Management API-endpoints for projektdata foljer monster:
```text
GET /project/v1/hubs/{hub_id}/projects/{project_id}/topFolders
GET /data/v1/projects/{project_id}/folders/{folder_id}/contents
```

Notera att `topFolders` ligger under `/project/v1/hubs/` medan `folders/.../contents` ligger under `/data/v1/projects/`. De tva endpointsen har olika bassokvagar.

### Variabler som redan finns i koden (rad 841-844)
```text
hubId = "b.3cfd791f-26ad-4a2a-beb5-1de4867081e1" (fran ACC_ACCOUNT_ID)
fullProjectId = "b.92e08fc7-768a-474b-8252-da1198fe3e79" (fran projektets ID)
```

### Vad som bor handa efter fixen
Nar "Visa mappar" fungerar korrekt ska den lista undermappar som representerar byggnader (t.ex. "Smasviken") och BIM-filer (RVT/IFC) inuti varje mapp.

### Ordning
1. Fixa topFolders-URL i edge function
2. Forbattra sync-locations feedback
3. Deploya och testa
