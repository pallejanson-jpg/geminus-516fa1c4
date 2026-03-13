
Mål: få kön att flyta (XKT först), stoppa “fastnar på första IFC”, och få A-1 in i Portfolio/Navigator utan ny uppladdning.

1) Vad jag hittade (orsak)
- `conversion-worker-api /pending` hämtar idag alltid äldsta `pending`-jobb (`created_at ASC`) utan prioritering.
- Aktuell kö visar många `pending` och **0 `processing`**; stora IFC-jobbet `6773e761...` ligger kvar som `pending` med `progress=33`.
- Loggar för det jobbet upprepar samma början (“Downloading IFC…”, “Parsing…”, “Converting storey 1/18…”), vilket tyder på återstart/retry på samma jobb.
- A-1 (`4d9c7202...`) har bara 2 asset-rader (Building + Model), inga Plan/Rum/Instance än.
- UI-anropet till `ifc-extract-systems` använder fel payload-nyckel (`ifcPath`), medan funktionen kräver `ifcStoragePath`.
- `ifc-extract-systems` returnerar idag systems/connectivity men populerar inte `assets`-hierarkin i nuvarande implementation.

2) Plan för ändring

A. Prioritering i `conversion-worker-api` (XKT före IFC)
- Uppdatera `GET /pending`:
  - Först hämta äldsta `pending` med `source_type='xkt'`.
  - Om ingen finns: hämta äldsta övriga `pending` (IFC-varianter).
- Behåll signerad URL-logik oförändrad.

B. Avhjälp “fastnar”
- Göra jobb-plockningen robust så samma `pending`-jobb inte återstartas i loop:
  - Antingen:
    - API “claimar” jobbet direkt när `/pending` returnerar det (sätter `status='processing'` atomärt), eller
    - Worker uppdateras att alltid kalla `/claim` innan processning.
- Rekommenderat i denna kodbas: API-claim i `/pending` (fungerar även med nuvarande worker-script).
- Lägg till stale-hantering för `processing` (timeout, t.ex. 120 min) så döda jobb inte blockerar kön permanent.

C. Fixa A-1-hierarki utan ny IFC-uppladdning
- I `CreateBuildingPanel`:
  - ändra invoke-body till `{ buildingFmGuid, ifcStoragePath, mode: 'enrich-guids' }`.
  - justera loggning efter verkligt svarsfält (inte `levelsCreated/spacesCreated` om de inte returneras).
- I `ifc-extract-systems`:
  - implementera “enrich-guids”-flöde som också upsertar `assets` (Building Storey, Space, Instance) med deterministiska GUIDs.
- Backfill för redan uppladdade A-1-filer (ARK.ifc + RIV.ifc):
  - trigga `ifc-extract-systems` mot befintliga storage paths.
  - ingen ny uppladdning krävs.

3) Svar på din fråga om A-1
- Nej, du ska inte behöva läsa in IFC igen.
- Efter fix + backfill kan vi använda redan uppladdade filer och fylla Plan/Rum/Asset till databasen direkt.

4) Tekniska detaljer
- Filer som ändras:
  - `supabase/functions/conversion-worker-api/index.ts`
  - `supabase/functions/ifc-extract-systems/index.ts`
  - `src/components/settings/CreateBuildingPanel.tsx`
- Ingen databasmigration krävs för grundfixen.
- Verifiering efter implementation:
  1. Köa alla byggnader.
  2. Kontrollera att XKT-jobb plockas före IFC i `conversion_jobs`.
  3. Kontrollera att minst ett jobb går till `processing` (inte bara `pending`).
  4. Kör backfill för A-1 och verifiera att `assets` får Storey/Space/Instance.
  5. Bekräfta att A-1 syns i Portfolio/Navigator utan ny IFC-upload.
