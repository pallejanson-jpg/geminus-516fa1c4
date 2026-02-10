
# ACC till Asset+ synkronisering

## Oversikt

Skapa en ny edge function `acc-to-assetplus` som tar ACC-synkade objekt fran den lokala databasen och skriver dem till Asset+ via dess API. Objekten ska fa riktiga UUID-baserade FmGuid (som Asset+ kraver) och flaggan `createdInModel = true` (Finns i modell = Yes).

## Utmaningar och losningar

### 1. FmGuid-format

ACC-objekt har idag fm_guid som `acc-bim-building-urnadsk...` -- detta ar inte ett giltigt UUID som Asset+ kraver. Losningen:

- Generera ett riktigt UUID (v4) for varje ACC-objekt vid forsta synk till Asset+
- Spara mappningen `acc_fm_guid -> assetplus_fm_guid` i en ny tabell `acc_assetplus_guid_map`
- Vid efterfoljande synkar, anvand befintlig mappning

### 2. Asset+ hierarki-krav

Asset+ kraver strikt hierarki vid skapande:
- **Complex** (Fastighet) -- maste skapas forst, inget parent
- **Building** -- kraver ett existerande Complex som parent (`parentFmGuid`)
- **Level** -- kraver ett existerande Building som parent
- **Space** -- kraver ett existerande Building som parent
- **Instance** -- kraver ett existerande Building som parent

Det finns inget Complex i ACC-data idag. Losning: Skapa ett default Complex (eller lat anvandaren valja ett existerande) innan byggnaden skapas.

### 3. Obligatoriska falt per objekttyp

Fran sync-api.md:
- Complex: `Designation` + `CommonName` (obligatoriska, satt till samma varde om bara ett finns)
- Building: `Designation` + `CommonName` + `ParentFmGuid` (Complex)
- Level: `Designation` + `CommonName` + `ParentFmGuid` (Building)
- Space: `Designation` + `CommonName` + `ParentFmGuid` (Building)
- Instance: Bara `ParentFmGuid` (Building), designation/commonName valfria

### 4. createdInModel-flagga

ACC-objekt ar redan `created_in_model = true` i databasen. Dock ar `createdInModel` en read-only systemegenskap i Asset+ -- den satts automatiskt nar objekt skapas via en IFC/Revit-modell. For objekt skapade via API utan modell (som dessa) blir `createdInModel = false/null`.

For att uppna "Finns i modell = Yes" i Asset+ behovs antingen:
- a) Att objekten kopplas till en BIM-modell via `ProcessIfc` / revision-flode (komplext)
- b) Att man uppdaterar egenskapen via `UpdateBimObjectsPropertiesData` (om den ar redigerbar)
- c) Acceptera att `createdInModel` inte satts, men lagga till en user parameter "ACC Modell" = true for att markera ursprunget

Rekommendation: Borja med (c) -- skapa en user parameter som marker att objektet kommer fran ACC-modell. Utred (a/b) som nastarsteg.

## Implementation

### Steg 1: Ny databastabell `acc_assetplus_guid_map`

```text
acc_fm_guid     TEXT PRIMARY KEY   -- t.ex. "acc-bim-building-urn..."
assetplus_fm_guid UUID NOT NULL    -- Genererat UUID for Asset+
object_type     INTEGER            -- 0=Complex, 1=Building, 2=Level, 3=Space, 4=Instance
synced_at       TIMESTAMPTZ
```

### Steg 2: Ny edge function `acc-to-assetplus`

Flode:
1. Hamta alla ACC-objekt fran `assets`-tabellen (where `attributes->>'source' = 'acc-bim'`)
2. For varje byggnad:
   a. Kontrollera om den redan har en Asset+ mappning (i `acc_assetplus_guid_map`)
   b. Om inte: Generera UUID, skapa Complex + Building via `AddObjectList`
   c. Skapa Levels via `AddObjectList` (parent = Building FmGuid)
   d. Skapa Spaces via `AddObjectList` (parent = Building FmGuid)
   e. Skapa Instances via `AddObjectList` (parent = Building FmGuid, batch om 50)
   f. Satt relationships via `UpsertRelationships` (koppla Space till Level, Instance till Space)
   g. Uppdatera properties via `UpdateBimObjectsPropertiesData` (commonName, designation, etc.)
3. Spara alla mappningar i `acc_assetplus_guid_map`
4. Uppdatera lokala `assets`-rader med de nya Asset+ FmGuid (lagga till i attributes)

### Steg 3: UI-knapp i ApiSettingsModal

Lagg till en "Synka till Asset+" knapp i ACC-sektionen av installningarna. Knappen:
- Visar hur manga ACC-objekt som annu inte synkats till Asset+
- Kor synken sekventiellt (en byggnad i taget) med progress-indikator
- Visar resultat (antal skapade / misslyckade)

### Steg 4: Uppdatera `acc-sync` for att satta `created_in_model`

Forsalra att alla ACC-objekt som synkas fran BIM-modeller far `created_in_model = true` i den lokala databasen (detta ar redan implementerat).

## Ordning for skapande i Asset+

```text
1. Complex (om det inte redan finns)
   |
   +-- 2. Building (ParentFmGuid = Complex)
       |
       +-- 3. Level (ParentFmGuid = Building)
       |
       +-- 4. Space (ParentFmGuid = Building)
       |
       +-- 5. Instance (ParentFmGuid = Building)

6. UpsertRelationships: Space -> Level, Instance -> Space
7. UpdateBimObjectsPropertiesData: commonName, designation, area, etc.
```

## Filer att skapa/andra

| Fil | Andring |
|---|---|
| `supabase/migrations/xxx_acc_assetplus_guid_map.sql` | Ny tabell for GUID-mappning |
| `supabase/functions/acc-to-assetplus/index.ts` | Ny edge function for synk ACC -> Asset+ |
| `src/components/settings/ApiSettingsModal.tsx` | UI-knapp "Synka till Asset+" med progress |

## Framtida arbete (utanfor scope)

- Utred om `createdInModel` kan sattas via API eller om det kraver en modell-koppling
- XKT-hantering: Asset+ behover XKT-filer (RestoreRevisionAndXktData endpoint finns) -- detta ar ett separat arbete
- Tvavags-synk: Hantera uppdateringar fran Asset+ tillbaka till ACC-data
- Parameterkonfiguration: Hamta `GetAllParameters` fran Asset+ for att mappa ratt user parameters
