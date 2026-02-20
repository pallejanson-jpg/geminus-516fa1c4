

## Ny funktion: Skapa byggnad med IFC-uppladdning

### Oversikt

En ny flik "Byggnad" laggs till i Installningar (ApiSettingsModal) dar anvandaren kan:

1. Skapa en ny Fastighet (Complex) + Byggnad i Asset+ med korrekta FMGUID:s
2. Ladda upp en IFC-fil som konverteras till XKT for 3D-visning
3. Allt registreras bade i Asset+ och lokala databasen

### Flode (steg for steg)

```text
Anvandaren oppnar Installningar -> Ny flik "Byggnad"
  |
  v
Steg 1: Grunduppgifter
  - Fastighetsbeteckning (designation) + namn (commonName) for Complex
  - Byggnadsbeteckning + namn for Building
  - Latitude/Longitude (valfritt, for kartan)
  |
  v
Steg 2: Klicka "Skapa i Asset+"
  - Edge function skapar Complex (ObjectType 0) via AddObjectList
  - Returnerat FmGuid anvands som parent for Building (ObjectType 1)
  - Building skapas via samma endpoint
  - Bada sparas lokalt i assets-tabellen + building_settings
  |
  v
Steg 3: Ladda upp IFC-fil (valfritt)
  - Filinput accepterar .ifc-filer
  - Filen konverteras till XKT i webblasaren via xeokit-convert + web-ifc
  - XKT sparas i xkt-models bucket
  - Metadata sparas i xkt_models-tabellen
  |
  v
Klart! Byggnaden syns i Portfolio, Navigator och 3D-viewer
```

### Teknisk implementation

#### 1. Ny edge function: `asset-plus-create-building`

En ny dedikerad edge function som hanterar hela hierarki-skapandet (Complex + Building). Den befintliga `asset-plus-create` hanterar bara Instance-objekt.

Flodet i edge function:
1. Ta emot: `{ complexDesignation, complexName, buildingDesignation, buildingName }`
2. Generera FmGuid for bade Complex och Building
3. Skapa Complex via `AddObjectList` med ObjectType 0, ingen parent
4. Skapa Building via `AddObjectList` med ObjectType 1, parentFmGuid = Complex FmGuid
5. Spara bada lokalt i `assets`-tabellen
6. Skapa en rad i `building_settings` med latitude/longitude
7. Returnera bada FmGuids

Asset+ API-payload for Complex (fran sync-api.md):
```json
{
  "BimObjectWithParents": [{
    "BimObject": {
      "ObjectType": 0,
      "Designation": "FASTIGHET-01",
      "CommonName": "Min Fastighet",
      "APIKey": "<api-key>",
      "FmGuid": "<genererat-uuid>",
      "UsedIdentifier": 1
    }
  }]
}
```

Asset+ API-payload for Building:
```json
{
  "BimObjectWithParents": [{
    "ParentFmGuid": "<complex-fm-guid>",
    "UsedIdentifier": 1,
    "BimObject": {
      "ObjectType": 1,
      "Designation": "BYGGNAD-01",
      "CommonName": "Min Byggnad",
      "APIKey": "<api-key>",
      "FmGuid": "<genererat-uuid>",
      "UsedIdentifier": 1
    }
  }]
}
```

#### 2. Ny UI-komponent: `CreateBuildingPanel.tsx`

Placeras i `src/components/settings/CreateBuildingPanel.tsx`. Innehaller:

- Formulardel med falt for:
  - Fastighetsbeteckning + namn
  - Byggnadsbeteckning + namn
  - Latitude/Longitude (valfritt)
- "Skapa"-knapp som anropar edge function
- IFC-uppladdningsdel (visas efter att byggnaden skapats):
  - Filval (`<input type="file" accept=".ifc">`)
  - Konverteringslogg som visar progress
  - Anvander `convertGlbToXkt()` fran `acc-xkt-converter.ts`
  - Sparar XKT via Supabase Storage + `xkt_models`-tabellen

#### 3. Ny flik i ApiSettingsModal

Lagg till en ny TabsTrigger "Byggnad" med Building2-ikonen i tabblisten. TabsContent renderar `CreateBuildingPanel`.

#### 4. Config.toml

Lagg till `[functions.asset-plus-create-building]` med `verify_jwt = false`.

### Filer som skapas/andras

| Fil | Andring |
|---|---|
| `supabase/functions/asset-plus-create-building/index.ts` | **NY** - Edge function for att skapa Complex + Building i Asset+ |
| `src/components/settings/CreateBuildingPanel.tsx` | **NY** - UI-komponent med formular och IFC-uppladdning |
| `src/components/settings/ApiSettingsModal.tsx` | Lagg till ny flik "Byggnad" med CreateBuildingPanel |
| `supabase/config.toml` | Lagg till `[functions.asset-plus-create-building]` |

### Sakerhetsaspekter

- Edge function anvander `verifyAuth` for att sakerstalla inloggad anvandare
- Alla Asset+ credentials hamtas fran Supabase secrets (redan konfigurerade)
- Lokala databasoperationer anvander service role key i edge function
- Inga nya RLS-policyer behovs -- befintliga policyer pa `assets` och `building_settings` tillater INSERT for autentiserade anvandare

