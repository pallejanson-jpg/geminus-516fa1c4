

# Plan: IFC → Assets Pipeline med GUID-generering, tillbakaskrivning och diff-hantering

## Problemet

Nuvarande IFC-pipeline (alla tre vägar: edge function, browser, worker) skapar bara `xkt_models` + `asset_external_ids` + `systems`. **Ingen av dem skriver till `assets`-tabellen**, som driver Navigator, Portfolio, filterpaneler och rum-labels. Dessutom saknas:

1. **GUID-generering** — objekt utan IFC GlobalId får ingen deterministisk fm_guid
2. **Tillbakaskrivning** — genererade fm_guid skrivs inte tillbaka in i IFC-filen
3. **Diff/borttagning** — om ett objekt försvinner från en ny IFC-import tas det inte bort från databasen

## Lösning i tre delar

### Del 1: Populate `assets` från IFC-metadata

Utöka `ifc-to-xkt` edge function (och `conversion-worker-api /complete`) med en ny funktion `populateAssetsFromIfc()` som körs efter XKT-generering:

- Itererar alla `metaObjects` från parsad IFC
- För varje `IfcBuildingStorey` → upsert i `assets` med `category: 'Building Storey'`
- För varje `IfcSpace` → upsert med `category: 'Space'`, `level_fm_guid` = parent storey
- För varje instansobjekt (IfcDoor, IfcWall, etc.) → upsert med `category: 'Instance'`, korrekt `level_fm_guid` och `in_room_fm_guid`
- `fm_guid` bestäms av IFC GlobalId om det finns, annars uuid5(buildingFmGuid + objectName + type)
- Alla markeras `is_local: false`, `created_in_model: true`

### Del 2: GUID-tillbakaskrivning till IFC

Om fm_guid genererades (uuid5) och inte fanns i IFC:en:
- Använd `web-ifc` API:t (`ifcApi.CreateIfcGuidProperty` / `WriteLine`) för att skriva genererad GUID som IfcPropertySingleValue i ett PropertySet (t.ex. "Geminus_Identifiers")
- Ladda upp den berikade IFC:en tillbaka till `ifc-uploads` bucket (som `{original}_enriched.ifc`)
- Detta säkerställer att nästa import matchar samma fm_guid

### Del 3: Diff-hantering (borttagning av borttagna objekt)

Efter populate-steget:
1. Hämta alla `assets` i databasen för `building_fm_guid` där `created_in_model = true`
2. Jämför mot listan av fm_guids som just parsades från IFC
3. Objekt som finns i DB men **inte** i den nya IFC:en → markeras som borttagna:
   - Sätt `modification_status = 'removed'` (soft-delete först)
   - Eller radera direkt om `is_local = false`
4. Objekt som finns i IFC och **matchar** i DB → uppdatera egenskaper (namn, typ, rumsplacering)

### Filer att ändra

| Fil | Ändring |
|-----|---------|
| `supabase/functions/ifc-to-xkt/index.ts` | Lägg till `populateAssetsFromIfc()` efter steg 8 (persist systems). Inkludera diff-logik. |
| `supabase/functions/conversion-worker-api/index.ts` | Ny action `POST /populate-hierarchy` som worker kan anropa efter konvertering |
| `docs/conversion-worker/worker.mjs` | Efter `/complete`, anropa `/populate-hierarchy` med storey/space/instance-data |
| `src/components/settings/CreateBuildingPanel.tsx` | Browser-konverteringen: efter `convertToXktWithMetadata`, skriv hierarchy till `assets` via Supabase client |
| `supabase/functions/ifc-extract-systems/index.ts` | Utöka med samma `populateAssetsFromIfc()` för systems-only-läget |

### Datamodell för insättning

```text
Building Storey:
  fm_guid:           IFC GlobalId || uuid5(buildingGuid + name)
  category:          "Building Storey"
  name/common_name:  storey.name
  building_fm_guid:  buildingFmGuid
  is_local:          false
  created_in_model:  true

Space:
  fm_guid:           IFC GlobalId || uuid5(buildingGuid + name)
  category:          "Space"
  name/common_name:  space.name
  building_fm_guid:  buildingFmGuid
  level_fm_guid:     parent storey fm_guid
  is_local:          false
  created_in_model:  true

Instance (IfcDoor, IfcWall, etc.):
  fm_guid:           IFC GlobalId || uuid5(buildingGuid + name + type)
  category:          "Instance"
  name/common_name:  element.name
  asset_type:        ifcType
  building_fm_guid:  buildingFmGuid
  level_fm_guid:     resolved storey
  in_room_fm_guid:   resolved space (if parent is IfcSpace)
  is_local:          false
  created_in_model:  true
```

### Diff-flöde vid omimport

```text
IFC Import → parse metaObjects → resolve fm_guids
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
              Nytt objekt      Matchat objekt      Borttaget objekt
              INSERT asset     UPDATE egenskaper    DELETE / soft-delete
                               (namn, rum, typ)     från assets
```

### Varför det inte var löst tidigare

`ifc-extract-systems` hade GUID-reconciliering och `asset_external_ids`-skrivning, men **stoppade där** — den skrev aldrig till `assets`-tabellen. `ifc-to-xkt` extraherade levels/spaces som return-data men persisterade dem inte heller. GUID-tillbakaskrivning till IFC diskuterades i minnet (`ifc-metadata-extraction-and-guid-enrichment-v1`) men implementerades bara för property sets, inte som en del av den fullständiga import-pipelinen.

