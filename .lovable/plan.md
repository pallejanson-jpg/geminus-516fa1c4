

## Plan: Viewer Improvements — 7 ändringar

### 1. BuildingSelector: Visa "Fastighetsnamn - Byggnadsnamn"

**Fil:** `src/components/viewer/BuildingSelector.tsx`

Ändra rad 277 där byggnadsnamnet visas. Lägg till `complexCommonName` framför `commonName` (samma mönster som i PortfolioView).

Format: `{complexCommonName} - {commonName || name}`  
Exempel: "DNB - Akerselva Atrium", "HUS F - Balingsnäs förskola"

Om `complexCommonName` saknas visas bara byggnadsnamnet.

---

### 2. Rumsvisualisering: Lägg till "None"-alternativ + Spaces-hantering

**Fil:** `src/components/viewer/VisualizationToolbar.tsx` (RoomVisualizationList, rad 48-114)

- Lägg till `{ type: 'none', icon: X, label: 'None' }` i `VIZ_LIST_ITEMS` (eller som separat knapp högst upp i listan).
- Uppdatera `toggle`-funktionen: vid val av typ som inte är 'none' → aktivera Spaces (`onToggleVisualization(true)`). Vid val av 'none' → stäng av Spaces.
- Nuvarande logik i `toggle` gör redan detta delvis men behöver explicit "None"-val i listan.

**Fil:** `src/components/viewer/RoomVisualizationPanel.tsx`

- Säkerställ att vid `visualizationType === 'none'` alla färger rensas OCH Spaces stängs av (dispatch `FORCE_SHOW_SPACES` med `show: false`).

---

### 3. Rumsvisualisering ihopveckbar — standard stängd

**Fil:** `src/components/viewer/VisualizationToolbar.tsx`

Wrappa `RoomVisualizationList` i en `Collapsible` med `defaultOpen={false}`. Klickbart rubrik "Color filter" som expanderar listan.

---

### 4. Flytta Room Labels under Show Spaces

**Fil:** `src/components/viewer/VisualizationToolbar.tsx`

Flytta Room Labels-blocket (rad ~970-1003) från insidan av `<CollapsibleContent>` (Viewer Settings) till direkt under "Show spaces"-switchen (rad ~877). Visa Room Labels-select bara om `showSpaces` är aktivt.

---

### 5. Properties: Ny flik "Geminus Properties" + System-flik med GUIDs

**Fil:** `src/components/common/UniversalPropertiesDialog.tsx`

Ändra sektionsindelningen:
- **System-fliken**: Flytta alla properties vars värde innehåller en 128-bitars GUID (regex: `/^[0-9a-f]{8}-[0-9a-f]{4}/i`) hit. Alltså `fm_guid`, `building_fm_guid`, `level_fm_guid` etc.
- **Ny flik "Geminus Properties"**: Alla övriga properties: `common_name`, `asset_type`, koordinater, area, user-defined attributes. Visa ALLA attribut från assets-tabellen inklusive user-defined.

Uppdatera `SECTION_LABELS` med `'geminus': 'Geminus Properties'`.
Ändra section-tilldelningen i `allProperties` memon: egenskaper med GUID-värden → 'system', övriga → 'geminus'.

---

### 6. Filtermenyn: A-modell-only Levels & Spaces + korrekt modellfiltrering

**Fil:** `src/components/viewer/ViewerFilterPanel.tsx`

**a) Levels — visa bara A-modellens:**
I `levels` memon (rad ~224-258), filtrera bort levels vars `sourceGuid` INTE tillhör en A-modell. Använd `isArchitecturalModel()` mot `sourceNameLookup` eller `sharedModels` för att identifiera A-modellen.

**b) Spaces — visa bara A-modellens:**
I `spaces` memon (rad ~319-407), filtrera spaces till de som har `levelFmGuid` kopplat till en A-modell-level (identifierat ovan).

**c) Modellselektering — visa bara vald modell:**
I `applyFilterVisibility` (rad ~838-873, Source filter): nuvarande logik samlar ihop IDs men adderar allt från levels. Ändra så att vid source-selektering ALLA objekt i den valda modellens `scene.models[modelId].objects` samlas, inte bara storeybaserade IDs. Och BARA de modellerna som är valda ska vara synliga — allt annat göms.

**d) Stabilitet — ta bort bakgrundsklick:**
Rad 1506: `<div className="fixed inset-0 z-[64]" onClick={onClose} />` — ta bort denna backdrop som stänger panelen vid klick utanför. Panelen ska bara stängas via X-knappen.

---

### Sammanfattning

| Fil | Ändring |
|-----|---------|
| `BuildingSelector.tsx` | Visa "Complex - Building" i byggnadslistan |
| `VisualizationToolbar.tsx` | None-val i viz-lista, ihopveckbar, Room Labels under Show Spaces |
| `RoomVisualizationPanel.tsx` | None → stäng Spaces |
| `UniversalPropertiesDialog.tsx` | System = GUIDs, ny Geminus Properties-flik |
| `ViewerFilterPanel.tsx` | A-modell-only levels/spaces, bättre source-filter, ta bort backdrop |

