
## Vad felet betyder (enkelt)
Det här är inte ett fel i er databas i Lovable Cloud, utan ett fel som kommer från **Asset+ backend** (de verkar köra MongoDB). Meddelandet:

> “Sort exceeded memory limit of 104857600 bytes … Pass allowDiskUse:true …”

betyder att Asset+ försöker **sortera en väldigt stor resultatsamling i RAM**, men den träffar MongoDB:s standardgräns på **100 MB** för in-memory sort. När den gränsen passeras aborterar Asset+ och svarar 500.

Viktigt: det kan hända även om vi bara begär `take: 200`, eftersom servern ofta måste sortera *hela* matchningen innan den tar ut “sidan”.

## Varför det händer “på slutet” trots att 80k/82k redan är nere
Jag har kollat er progress i backend-tabellen `asset_sync_progress` och den visar:

- `current_building_index = 12` (dvs byggnad 13 av 14)
- `skip = 43500`
- `total_synced = 80278`

Det betyder att synken har fastnat på en specifik byggnad med extremt mycket data, och nu när `skip` blivit väldigt stort blir frågan extra tung för Asset+ (deep pagination + sort). Det är därför det funkar “nästan hela vägen” men kraschar när den kommer till just den byggnaden/sidläget.

## Målet
1) Göra synken robust så att den kan “ta sig förbi” MongoDB-sort-felet och få ner de sista ~2000 objekten.  
2) Ge tydlig feedback i synkdialogen istället för hårt 500-stopp.  
3) Minimera risken att den fastnar igen vid höga `skip`.

---

## Lösning (stegvis)

### Steg 1 — Förbättra Asset+-frågan så att den blir billigare att sortera
I `supabase/functions/asset-plus-sync/index.ts` (funktionen `fetchAssetPlusObjects`) lägger vi till:

- **Explicit sort** (DevExtreme-stil): `sort: [{ selector: "fmGuid", desc: false }]`
- **Select/projection** för att minska dokumentstorlek: `select: ["fmGuid","objectType","designation","commonName","buildingFmGuid","levelFmGuid","inRoomFmGuid","complexCommonName","grossArea","ObjectTypeValue","createdInModel","dateModified"]`

Varför:
- Sort på ett stabilt fält (fmGuid) ökar chansen att Asset+ kan använda index / mindre minne.
- `select` gör varje “rad” mindre, vilket kan göra sorten mindre minneskrävande.

Vi applicerar samma sort (och minimal select) även i `getRemoteCountByTypes` (som ibland kan trigga tunga operationer när `requireTotalCount: true` används).

### Steg 2 — Adaptiv retry/backoff när vi får just “sort memory limit”
I samma edge function fångar vi felet när `errorText` innehåller t.ex.:
- `"Sort exceeded memory limit"` eller `"allowDiskUse:true"`

Då gör vi automatiskt:
- Retry med eskalerande “snällare” inställningar, t.ex.:
  - `take: 200` → `100` → `50` → `25`
  - alltid med `select` (reducerad payload)
  - alltid med explicit `sort`
- Kort jitter/backoff (t.ex. 250–500ms) mellan retry för att undvika att slå i samma “hot path” i Asset+.

Målet är att den ska kunna “bita av” även när Asset+ är känslig.

### Steg 3 — Ny pagination-strategi som undviker “skip 43500”-läget (cursor-läge)
Om backoff fortfarande träffar minnesfelet (särskilt när `skip` blir stort), inför vi en fallback till **cursor-baserad pagination** för den byggnaden:

- Vi kör med `sort` på `"fmGuid"` och istället för `skip`, använder vi:
  - `filter: [ ["buildingFmGuid","=",X], "and", ["objectType","=",4], "and", ["fmGuid",">", lastFmGuid] ]`
  - `skip: 0`
- Efter varje batch sparar vi `lastFmGuid = sista fmGuid i batchen` som cursor.

Detta kräver att vi sparar mer progress än bara `skip`.

#### Databasändring (schema)
Vi utökar `public.asset_sync_progress` med nya nullable kolumner (migration):
- `cursor_fm_guid text null`  (sista fmGuid i senaste batch)
- `page_mode text null` (t.ex. `'skip' | 'cursor'`)
- ev. `last_error text null` (för UI-diagnostik)

### Steg 4 — UI: Visa begriplig förklaring och fortsätt automatiskt
I `src/components/settings/ApiSettingsModal.tsx` i `handleSyncAssetsChunked`:

- Om edge function returnerar en kontrollerad “soft fail” (200 OK men `{ success:false, code:"ASSETPLUS_SORT_MEMORY_LIMIT" ... }`) så:
  - Visar vi en toast som säger ungefär:
    - “Asset+ klarade inte sorteringen (serverbegränsning). Vi provar en annan strategi…”
  - Fortsätter automatiskt (eftersom det i praktiken är en retry/fallback, inte ett “hårt stopp”).
- Vi visar också tydligare statusrad i kortet (assets syncState):
  - Vilken byggnad den är på
  - Om den kör “skip” eller “cursor” mode

### Steg 5 — Säkerhetsventiler/verktyg
För att slippa låsa fast sig:
- Ny action i edge function: `reset-assets-progress` (admin-only)
  - Rensar `asset_sync_progress` för `job='assets_instances'`
  - (Valfritt) kan sätta syncState till “interrupted” med en tydlig text

---

## Förväntad effekt
- Synken ska kunna fortsätta förbi byggnad 13/14 där `skip=43500` och få ner resterande objekt.
- Även om Asset+ ibland är “instabil” i sin sort, ska vi gradvis gå mot en strategi som kräver mindre av servern.
- UI ska inte “bara dö” på 500, utan guida användaren och automatiskt försöka vidare.

---

## Testplan (konkret)
1. Kör “Alla Tillgångar” i synkdialogen.
2. Verifiera att den fortsätter från nuvarande progress (byggnad 13/14).
3. Om den träffar sort-felet:
   - Verifiera att den först provar backoff (200→100→50→25) och att UI visar ett begripligt meddelande.
4. Om backoff inte räcker:
   - Verifiera att den växlar till cursor mode (skip=0 och cursor_fm_guid uppdateras i progress).
5. När klar:
   - `check-sync-status` ska visa `assets.inSync = true` och att local ≈ remote för Instances.

---

## Tekniska filer som kommer ändras
- `supabase/functions/asset-plus-sync/index.ts`
  - lägga till sort + select
  - retry/backoff på “Sort exceeded memory limit”
  - cursor-pagination fallback
  - ev. ny action `reset-assets-progress`
- Databas-migration: `asset_sync_progress` (nya kolumner)
- `src/components/settings/ApiSettingsModal.tsx`
  - bättre hantering av kontrollerade felkoder och bättre statusfeedback

---