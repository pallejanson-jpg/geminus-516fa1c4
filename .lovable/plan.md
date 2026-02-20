

## Skapa byggnad med A-modell och IFC-hierarki i Asset+

### Oversikt

Utoka det befintliga byggnadsverktyget sa att hela Asset+-hierarkin skapas korrekt nar en IFC-fil laddas upp:

```text
Complex (ObjectType 0) -- Fastighet
  |
  Building (ObjectType 1) -- Byggnad  
    |
    Model (ObjectType 5) -- t.ex. "A-modell"
      |
      +-- Level (ObjectType 2) -- Vaningsplan fran IFC (IfcBuildingStorey)
      +-- Space (ObjectType 3) -- Rum fran IFC (IfcSpace)  
      +-- Instance (ObjectType 4) -- Objekt (framtida)
```

### Flode

```text
1. Anvandaren fyller i fastighets- och byggnadsuppgifter (som idag)
2. Anvandaren anger ett modellnamn, t.ex. "A-modell" (nytt falt)
3. Klicka "Skapa i Asset+"
   -> Complex, Building OCH Model skapas i Asset+ via edge function
   -> Alla sparas lokalt med korrekta FmGuids
4. Ladda upp IFC-fil
   -> Konverteras till XKT (som idag)
   -> IFC-hierarkin (vaningsplan, rum) parsas fran XKT-modellens metadata
   -> Vaningsplan och rum skapas i Asset+ via AddObjectList
   -> Sparas aven lokalt i assets-tabellen
   -> XKT sparas i storage
```

### Teknisk implementation

#### 1. Uppdatera edge function `asset-plus-create-building`

Lagg till ett tredje steg: Skapa Model (ObjectType 5) under Building.

Asset+ API-payload for Model:
```json
{
  "BimObjectWithParents": [{
    "ParentFmGuid": "<building-fm-guid>",
    "UsedIdentifier": 1,
    "BimObject": {
      "ObjectType": 5,
      "Designation": "A-modell",
      "CommonName": "A-modell",
      "APIKey": "<api-key>",
      "FmGuid": "<genererat-uuid>",
      "UsedIdentifier": 1,
      "SourceType": 1
    }
  }]
}
```

`SourceType: 1` = IFC (fran enum i API-schemat).

Edge function returnerar nu aven `modelFmGuid` i svaret.

Uppdatera aven payloaden att ta emot `modelName` (t.ex. "A-modell") fran frontend.

#### 2. Ny edge function `asset-plus-create-hierarchy`

En separat edge function som tar emot parsad IFC-hierarki och skapar objekt i Asset+. Anropas fran frontend efter att IFC parserats.

Payload:
```json
{
  "buildingFmGuid": "...",
  "modelFmGuid": "...",
  "levels": [
    { "fmGuid": "...", "designation": "Plan 01", "commonName": "Vaningsplan 1" }
  ],
  "spaces": [
    { "fmGuid": "...", "designation": "101", "commonName": "Kontor", "levelFmGuid": "..." }
  ]
}
```

Logik:
1. Skapa alla Levels (ObjectType 2) under Building med `AddObjectList`
2. Skapa alla Spaces (ObjectType 3) under Building med `AddObjectList`
3. Anvand `UpsertRelationships` for att koppla Spaces till ratt Level
4. Spara allt lokalt i assets-tabellen

#### 3. Uppdatera `acc-xkt-converter.ts`

Utoka `convertGlbToXkt` (eller skapa ny funktion `convertIfcToXktWithMetadata`) som returnerar bade XKT-datan OCH en lista med extraherade metadataobjekt (floors, rooms) fran `xktModel.metaObjects` efter finalize().

Returformat:
```typescript
interface IfcHierarchyResult {
  xktData: ArrayBuffer;
  levels: Array<{ id: string; name: string; type: string }>;
  spaces: Array<{ id: string; name: string; type: string; parentId: string }>;
}
```

#### 4. Uppdatera `CreateBuildingPanel.tsx`

Andringar:
- Lagg till falt for "Modellnamn" (default: "A-modell")
- Skicka `modelName` till edge function
- Visa `modelFmGuid` i bekraftelsen
- Efter IFC-konvertering: extrahera hierarki fran metadata och anropa `asset-plus-create-hierarchy`
- Visa progress for hierarkiskapandet (t.ex. "Skapar 5 vaningsplan och 42 rum i Asset+...")
- Hantera aven fallen att ladda upp IFC till befintlig byggnad (valj fran lista)

#### 5. Config.toml

Lagg till `[functions.asset-plus-create-hierarchy]` med `verify_jwt = false`.

### Filer som skapas/andras

| Fil | Andring |
|---|---|
| `supabase/functions/asset-plus-create-building/index.ts` | Lagg till Model-skapande (ObjectType 5), ta emot modelName |
| `supabase/functions/asset-plus-create-hierarchy/index.ts` | **NY** - Skapar Levels + Spaces i Asset+ fran parsad IFC-data |
| `src/services/acc-xkt-converter.ts` | Ny funktion som returnerar bade XKT och extraherad IFC-hierarki |
| `src/components/settings/CreateBuildingPanel.tsx` | Modellnamn-falt, hierarki-skapande efter IFC-parsning, befintlig byggnad-dropdown |
| `supabase/config.toml` | Lagg till asset-plus-create-hierarchy |

### Relationshantering i Asset+

Notera fran API-dokumentationen:
- Levels, Spaces, Instances skapas med Building som `ParentFmGuid` (inte Model)
- Asset+ tilldelar automatiskt ratt `modelId` till objekten
- `UpsertRelationships` anvands for att flytta Spaces under ratt Level (om de skapats med Building som parent)
- Objekten far `createdInModel: false` eftersom de skapas via API (inte fran en BIM-modelluppladdning via Asset+ native)

### Sakerhetsaspekter

- Inga nya databastabeller behovs
- Befintliga RLS-policyer tillater INSERT pa assets och building_settings for autentiserade anvandare
- Edge functions anvander verifyAuth + service role for databasoperationer
- Alla Asset+ credentials hamtas fran redan konfigurerade secrets

