
# Forbattrad godkannandeprocess for AI-detektioner

## Oversikt

Nar ett AI-detekterat objekt godkanns ska det:
1. Oppna samma egenskapsdialog som vid manuell inventering (forifylld)
2. Automatiskt skapa en POI i Ivion med samma FM GUID
3. Kontrollera om objektet redan finns (deduplicering via FM GUID pa POI)

## Detaljerad design

### 1. Forifylld egenskapsdialog vid godkannande

Istallet for att direkt anropa `approve-detection` i edge-funktionen nar anvandaren klickar "Godkann", oppnas en dialog med InventoryForm-liknande falt forifyllda fran detektionsmallen och AI-data:

| Falt | Kalla |
|------|-------|
| Namn | `detection_templates.name` + AI-extraherade props (brand, model, size) |
| Objekttyp / Kategori | `detection_templates.default_category` |
| Beskrivning | `detection_templates.description` + AI-beskrivning |
| Symbol | `detection_templates.default_symbol_id` |
| Byggnad | `pending_detections.building_fm_guid` (redan kand) |
| Vaning | Matchning av `ivion_dataset_name` mot assets med category=IfcBuildingStorey |
| Skarmklipp | `pending_detections.thumbnail_url` visas som bild |
| Koordinater | `pending_detections.coordinate_x/y/z` (skrivskyddade) |

**Vaningsmatching**: Ivion-dataset-namn (t.ex. "Plan 2", "V2") matchas mot varje IfcBuildingStorey i byggnaden via namnlikheter. Om `ivion_dataset_name` innehaller samma text som ett vaningsplan-namn eller om det kan kopplas via FM GUID sa forifylls vaningen.

### 2. POI-skapande vid godkannande

Nar anvandaren bekraftar godkannande i dialogen:

1. Generera 128-bit FM GUID (`crypto.randomUUID()` -- redan implementerat)
2. Skapa asset i databasen med forifyllda + eventuellt redigerade varden
3. Anropa `ivion-poi` edge-funktionen med `action: 'sync-asset'` for att skapa POI
4. POI:ns `customData` innehaller `fm_guid` -- detta ar nyckeln for deduplicering
5. Uppdatera `pending_detections` med `created_asset_fm_guid` och `created_ivion_poi_id`

### 3. Deduplicering vid nasta skanning

Fore lagring av en ny detektion kontrolleras:

1. Hamta alla existerande POI:er for byggnaden (via Ivion API eller cachade i `assets`-tabellen)
2. For varje ny detektion: berakna 3D-avstand till befintliga assets med koordinater
3. Om en asset finns inom en troskeldistans (t.ex. 2 meter) och tillhor samma building -- markera som "redan inventerad" och hoppa over

Alternativ (enklare och mer palitlig):
- Vid analyze-screenshot: kolla om det redan finns en asset med samma `building_fm_guid` och koordinater inom 2m radie
- Om ja, skippa detektionen (lagg inte i pending_detections)

## Tekniska andringar

### Fil 1: `src/components/ai-scan/DetectionReviewQueue.tsx`

- Lagg till en ny `ApprovalDialog`-komponent som visas istallet for direkt godkannande
- Dialogen innehaller:
  - Skarmklipp (thumbnail) langst upp
  - Falt: Namn, Kategori, Beskrivning, Symbol (dropdown med annotation_symbols)
  - Byggnad (forifylld, ej andringsbar)
  - Vaning (dropdown med IfcBuildingStorey fran byggnaden, forifylld om matchning)
  - Rum (dropdown, valfritt)
  - Koordinater (visas skrivskyddade)
- "Godkann"-knappen skickar alla varden till edge-funktionen

### Fil 2: `supabase/functions/ai-asset-detection/index.ts`

Uppdatera `approveDetection`-funktionen:
- Ta emot ytterligare parametrar: `name`, `category`, `symbolId`, `description`, `levelFmGuid`, `roomFmGuid`
- Anvand dessa istallet for att hardkoda fran template
- Efter asset-skapande: anropa Ivion POI-skapande direkt (kopiera logik fran ivion-poi/syncAssetToPoi)
- Lagra `ivion_poi_id` pa bade asset och pending_detection

Uppdatera `analyze-screenshot`:
- Fore sparning av detektion: kolla om en asset redan finns i `assets`-tabellen med samma `building_fm_guid` och koordinater inom 2m
- Om match hittas: skippa detektionen och logga "Already inventoried"

### Fil 3: `supabase/functions/ai-asset-detection/index.ts` (vaningsmatching)

Lagg till hjalp-funktion `matchFloorByDatasetName`:
- Hamta alla IfcBuildingStorey-assets for byggnaden
- Jamfor `ivion_dataset_name` med varje vanings `name` och `common_name`
- Returnera matchande `fm_guid` eller null

### Sammanfattning av andringar

```text
Filer som andras:
  1. src/components/ai-scan/DetectionReviewQueue.tsx
     - Ny ApprovalDialog med forifyllda falt
     - Laddar annotation_symbols, vaningsplan, rum
     - Skickar utokade parametrar vid godkannande

  2. supabase/functions/ai-asset-detection/index.ts
     - approveDetection: tar emot formdata, skapar POI automatiskt
     - analyze-screenshot: deduplicering mot befintliga assets (2m radie)
     - Ny hjalp: matchFloorByDatasetName
```
