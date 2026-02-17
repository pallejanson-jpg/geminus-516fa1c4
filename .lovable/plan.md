

# Tre fixar: ACC-instellningar + FMA 2D-viewer

## 1. Auto-upptack ACC Account IDs via Hubs API (inget behov av manuella secrets)

Autodesk Data Management API har en `/project/v1/hubs` endpoint som returnerar alla hubbar (= konton) som appen har tillgang till. Varje hub har ett ID i formatet `b.{accountId}` och en `region`-attribut (US/EMEA).

**Plan:**
- Lagg till en ny action `list-hubs` i `acc-sync` edge function som anropar `GET /project/v1/hubs` med 2-legged eller 3-legged token
- Returnerar alla hubbar med `{ id, name, region }` 
- I `ApiSettingsModal.tsx`: nar ACC-fliken oppnas, hamta hubbar automatiskt. Visa dem som en lista/dropdown istallet for att forlita sig pa hardkodade secrets
- Anvandaren kan valja hub (= konto) fran listan, och regionen setts automatiskt baserat pa hubbens region
- `list-projects` andras sa att `accountId` kan skickas fran frontend istallet for att lasa fran secrets
- Inga nya secrets behovs -- `APS_CLIENT_ID` och `APS_CLIENT_SECRET` ar redan konfigurerade

## 2. Bevara ACC-state mellan modal-oppningar (sessionStorage)

- Spara `accFolders`, `accTopLevelItems`, `accRootFolderName`, `accProjects`, `selectedAccProjectId`, `accRegion`, hub-val i `sessionStorage`
- Ladda tillbaka vid modal-oppning
- Automatiskt hamta mappar om vi har ett sparat projekt-ID men inga mappar i cache
- Flytta "Synka platser", "Synka tillgangar", "Status" till en `Collapsible` under "Avancerat", behall "Visa mappar" som primar knapp

## 3. FMA 2D-viewer: fixa iframe-laddning

Loggar visar att edge function fungerar korrekt (hittar objectId 60 for Smaviken). Appen ar nu whitelistad. Problemet ar troligtvis att:
- `perspective/root` returnerar 404 (name lookup misslyckas), men GUID-subtree hittar drawing
- Eller att vaningsnamn inte skickas korrekt fran frontenden (loggen visar `floorName: (none)`)

**Plan:**
- Sakerstall att `floorName` skickas fran `UnifiedViewer`/`SplitViewer` till `FmAccess2DPanel` korrekt
- Kontrollera att `noFloorSelected`-checken (`!floorId && !floorName`) inte blockerar nar bara `floorName` finns
- Testa att iframe-URL:en laddar korrekt nu nar appen ar whitelistad (inget behov av "oppna i ny flik"-fallback)

---

## Tekniska detaljer

### Filandringar

**`supabase/functions/acc-sync/index.ts`**
- Ny action `list-hubs`: anropar `GET /project/v1/hubs`, returnerar `[{ id, name, region }]`
- Uppdatera `list-projects` sa att `accountId` kan skickas som parameter (fallback till secrets om ej angiven)
- Uppdatera `list-folders` pa samma satt

**`src/components/settings/ApiSettingsModal.tsx`**
- Auto-hamta hubbar vid oppning av ACC-fliken
- Hub-dropdown ersatter regions-knappar (region bestams av vald hub)
- sessionStorage-persistens for all ACC-state
- Flytta sekundara knappar till Collapsible "Avancerat"

**`src/components/viewer/FmAccess2DPanel.tsx`**
- Verifiera att iframe-laddning fungerar nu nar whitelisting ar pa plats
- Eventuellt ta bort for lang timeout (30s -> 15s)

**Kallas fran (undersok vid implementation)**
- `UnifiedViewer.tsx` / `SplitViewer.tsx` -- sakerstall att `floorName` och `buildingName` skickas korrekt till `FmAccess2DPanel`

