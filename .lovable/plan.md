

# Synka BIM-hierarki fran ACC via Model Properties API

## Sammanfattning

Vi bygger ut ACC-integrationen med ett nytt `sync-bim-data` action i edge-funktionen `acc-sync`. Nar du klickar "Synka BIM-data" pa en mapp (t.ex. "Jonkoping Science Tower") hamtas vaningsplan och rum direkt fran Autodesks Model Properties API -- utan att ladda ner nagon fil. Resultatet lagras i den befintliga `assets`-tabellen med samma monster som befintlig Location-synk.

Testfall: mappen **"Jonkoping Science Tower"** med A-modeller (arkitekt).

---

## Hur det fungerar

```text
1. Anvandaren klickar "Visa mappar"
   --> Listar mappar, t.ex. "Jonkoping Science Tower"
       --> Visar BIM-filer: A-xxx.rvt, K-xxx.rvt, etc.

2. Anvandaren klickar "Synka BIM-data" pa en mapp
   --> Edge function:
       a) Hamtar versionUrn for varje BIM-fil (tip-endpoint)
       b) Triggrar indexering via batch-status
       c) Pollar tills indexeringen ar klar (FINISHED)
       d) Hamtar fields (faltdefinitioner)
       e) Laddar ner alla properties (NDJSON med alla objekt)
       f) Filtrerar ut Revit Levels = vaningsplan, Revit Rooms = rum
       g) Skapar Building fran mappnamnet
       h) Upserta till assets-tabellen

3. Resultat visas i UI:
   "Skapade: 1 byggnad, 5 vaningsplan, 28 rum fran 2 modeller"
```

---

## Andringslista

### Fil 1: `supabase/functions/acc-sync/index.ts`

#### 1a. Nya hjalpfunktioner (efter rad ~519, fore SYNC STATE HELPERS)

- **`isBimFile(filename)`** -- Returnerar true om filen ar rvt/ifc/nwc/dwg
- **`fetchItemTip(token, projectId, itemId, regionHeaders)`** -- Anropar `GET /data/v1/projects/b.{pid}/items/{itemId}/tip` for att hamta versionUrn
- **`parseLDJSON(text)`** -- Parsar line-delimited JSON (en JSON-rad per rad)
- **`extractBimHierarchy(token, projectId, versionUrns, regionHeaders)`** -- Hela Model Properties-flodet:
  1. POST till `indexes:batch-status` med versionUrns
  2. Polla `indexes/{indexId}` tills FINISHED (max ~50 sek, 3 sek intervall)
  3. Hamta fields via `fieldsUrl` (fran batch-status-svaret)
  4. Hamta properties via `propertiesUrl` (NDJSON-format)
  5. Filtrera ut "Revit Level" och "Revit Rooms" baserat pa kategori-falt (`p5eddc473`)
  6. Returnera `{ levels: [...], rooms: [...] }` med namn, externalId och level-referens
- **`upsertBimAssets(supabase, folderName, folderId, levels, rooms, projectId)`** -- Konverterar BIM-data till assets-rader och upserta med samma monster som `upsertLocationAssets`:
  - Building: `fm_guid: "acc-bim-building-{folderId}"`
  - Building Storey: `fm_guid: "acc-bim-level-{externalId}"`, med `building_fm_guid` = building
  - Space: `fm_guid: "acc-bim-room-{externalId}"`, med `level_fm_guid` baserat pa level-match och `building_fm_guid` = building
  - Alla med `attributes.source = "acc-bim"`

#### 1b. Utoka `list-folders`-casen (rad ~942-953)

For varje BIM-fil (rvt/ifc/nwc) som listas i en mapp, anropa `fetchItemTip` och inkludera `versionUrn` i retur-objektet. Icke-BIM-filer (PDF etc.) far versionUrn = null.

Nuvarande items-mappning:
```text
items = subData.data.map(item => ({
  id, name, type, size, createTime
}))
```
Utokad:
```text
items = await Promise.all(subData.data.map(async item => ({
  id, name, type, size, createTime,
  versionUrn: isBimFile(name) ? await fetchItemTip(...) : null
})))
```

#### 1c. Nytt action `sync-bim-data` (fore `default`-casen, rad ~987)

Tar emot:
```text
{
  action: "sync-bim-data",
  projectId: "92e08fc7-...",
  region: "EMEA",
  folderName: "Jonkoping Science Tower",
  folderId: "urn:adsk.wipprod:dm.folder:xxx",
  items: [{ id, name, versionUrn }]
}
```

Gor:
1. Filtrera ut items med giltiga versionUrns
2. Anropa `extractBimHierarchy` med alla versionUrns
3. Anropa `upsertBimAssets` med resultatet
4. Returnera `{ success, message, building, levels, rooms, modelsIndexed }`

Om indexeringen inte ar klar inom timeout returneras `{ success: false, state: "PROCESSING", message: "Indexeringen pagar..." }` sa anvandaren kan prova igen.

### Fil 2: `src/components/settings/ApiSettingsModal.tsx`

#### 2a. Ny state (vid rad ~176)

```text
syncingBimFolderId: string | null  -- vilken mapp som synkas just nu
bimSyncProgress: string | null     -- progressmeddelande
bimSyncResult: { ... } | null      -- resultat att visa
```

#### 2b. Ny handler `handleSyncBimData(folder)` (efter `toggleFolder`, rad ~445)

1. Satt `syncingBimFolderId = folder.id`
2. Satt `bimSyncProgress = "Indexerar modeller..."`
3. Anropa `acc-sync` med `action: "sync-bim-data"`, mappdata och items (med versionUrns)
4. Vid resultat: visa toast med "Skapade X byggnad, Y vaningsplan, Z rum"
5. Vid PROCESSING: visa info att indexeringen pagar och prova igen
6. Nollstall state

#### 2c. "Synka BIM-data"-knapp i mappvyn (rad ~2074-2107)

Lagg till en knapp bredvid varje mapp-rads chevron/namn:

```text
[V] [mapp-ikon] Jonkoping Science Tower  [2 filer] [Synka BIM-data]
```

- Knappen visas bara om mappen har BIM-filer (minst en item med versionUrn)
- Under synkning: visa Loader2-spinner + progresstext istallet for knapptext
- Efter resultat: kort feedback i toast

---

## Tekniska detaljer

### API-endpoints (alla med 3-legged token)

| Endpoint | Syfte |
|----------|-------|
| `GET /data/v1/projects/b.{pid}/items/{itemId}/tip` | Hamta versionUrn |
| `POST /construction/index/v2/projects/{pid}/indexes:batch-status` | Starta/kolla indexering |
| `GET /construction/index/v2/projects/{pid}/indexes/{indexId}` | Polla status |
| `GET fieldsUrl` (fran batch-status-svar) | Faltdefinitioner (NDJSON) |
| `GET propertiesUrl` (fran batch-status-svar) | Alla objektegenskaper (NDJSON) |

### Kanda faltnycklar (Revit-modeller)

| Nyckel | Betydelse | Anvands for |
|--------|-----------|-------------|
| `p153cb174` | Namn (display name) | Objektnamn ("Plan 1", "Kok 101") |
| `p5eddc473` | Kategori | "Revit Level", "Revit Rooms" |
| `pdf1348b1` | Elevation | Vaningshojd (for levels) |
| `pbadfe721` | Level-referens | Koppla rum till vaningsplan |

Nycklarna verifieras dynamiskt via fields-hamtningen.

### Mappning till assets-tabellen

| BIM-data | assets.category | assets.fm_guid | Relationer |
|----------|----------------|----------------|------------|
| Mappnamn | Building | `acc-bim-building-{folderId}` | -- |
| Revit Level | Building Storey | `acc-bim-level-{externalId}` | building_fm_guid = building |
| Revit Room | Space | `acc-bim-room-{externalId}` | level_fm_guid = matchad level, building_fm_guid = building |

Alla poster far `attributes.source = "acc-bim"` for att skilja dem fran Location-synkade poster (`source: "acc"`).

### Timeout-hantering

- Edge functions har ~60s timeout
- Indexering kan ta langre for forsta gangen (modellen har aldrig indexerats)
- Losning: gor max ~50 sekunders polling, returnera sedan `{ state: "PROCESSING" }` sa att UI visar "Prova igen om en stund"
- Autodesk fortsatter indexeringen i bakgrunden, cachas 30 dagar

### Inga databasandringar kravs

Allt lagras i befintliga `assets`-tabellen med `fm_guid`-upsert.

---

## Implementationsordning

1. Lagg till hjalpfunktioner i edge function (`isBimFile`, `fetchItemTip`, `parseLDJSON`, `extractBimHierarchy`, `upsertBimAssets`)
2. Utoka `list-folders` med versionUrn-hamtning
3. Lagg till `sync-bim-data` action
4. Lagg till state, handler och synk-knapp i UI
5. Deploya edge function
6. Testa med "Jonkoping Science Tower"

