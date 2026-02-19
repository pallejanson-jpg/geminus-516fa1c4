

## Merge Larm into FM-flik + Visa i 3D + Rum-interaktion i 3D-panel

### Sammanfattning

Tre sammankopplade funktioner:

1. **Bygg FM-flik per byggnad** -- flytta larminnehall fran separat "Larm"-flik till en ny "FM"-flik i BuildingInsightsView, med riktiga rumsnamn/nummer istallet for GUIDs, plus en "Visa i 3D"-knapp
2. **Rum-kort i 3D** -- fran Space-fliken: farglagg rum i 3D-viewern och ta med sig rumslistan till InsightsDrawerPanel sa man kan jobba med rum i 3D
3. **InsightsDrawerPanel som arbetsyta** -- utoka panelen sa att den visar rumlistan med fargkodning och lat anvandaren tanda/slacka/klicka pa rum direkt i 3D

---

### Del 1: FM-flik med riktig data i BuildingInsightsView

**Andringar i `src/components/insights/BuildingInsightsView.tsx`:**

- Byt namn pa "Larm"-fliken (value="alarms") till **"FM"** (value="fm")
- Behall KPI-kort (totalt antal larm, vaningar med larm, snitt per vaning)
- Behall stapeldiagram (larm per vaningsplan)
- **Forbattra alarmlistan:**
  - Hamta rum-metadata (name, common_name) via en join-query: for varje alarm.in_room_fm_guid, sla upp motsvarande rum i allData eller en separat query
  - Visa kolumner: **Rumsnamn** | **Rumsnummer** | **Vaning** | **Datum** | **Visa i 3D** | Radera
  - Rumsnamn = common_name fran det rum som alarm.in_room_fm_guid pekar pa
  - Rumsnummer = name fran samma rum
  - Vaning = levelNames-map (redan implementerat)
- **"Visa i 3D"-knapp** pa varje alarm-rad + en global "Visa alla i 3D"-knapp:
  - Global-knappen: tar de 50 senaste larmens koordinater och navigerar till 3D-viewern med en URL-parameter (t.ex. `showAlarmAnnotations=50`) som triggar att annotations tands for dessa 50 larm
  - Per-rad-knapp: navigerar till 3D med `entity=<alarm.fm_guid>` for att flyga till och flash-highlighta det specifika larmet

**Data-hamtning:**
- Utoka fetchAlarmData sa att den ocksa hamtar `name, common_name, coordinate_x, coordinate_y, coordinate_z` for alarmen
- Hamta rum-lookup: `SELECT fm_guid, name, common_name FROM assets WHERE building_fm_guid = X AND category IN ('Space','IfcSpace')` -- anvand allData som redan finns i context istallet for ny query

---

### Del 2: Rum-visualisering fran Space-fliken till 3D

**Andringar i `src/components/insights/BuildingInsightsView.tsx` (Space-tab):**

- Lagg till en **"Visa rum i 3D"**-knapp i Space-fliken som:
  1. Bygger en colorMap dar varje rums fmGuid mappas till samma farg som i Room Types-pajen (baserat pa spaceType)
  2. Anropar `handleInsightsClick({ mode: 'room_spaces', colorMap })` -- detta fargar in rum i inline-viewern (desktop) eller navigerar till 3D (mobil)
- Rumskorten i Space-tabben far ocksa `onClick` som fargar in det specifika rummet i 3D

**Nytt insightsMode `room_spaces`:**
- Lagg till stod for detta mode i `RoomVisualizationPanel.tsx` (eller direkt i AssetPlusViewer via `insightsColorMap`)
- Befintlig logik i AssetPlusViewer hanterar redan `insightsColorMap` -- nar den ar satt fargas matchande IfcSpace-entiteter in med angivna farger

---

### Del 3: InsightsDrawerPanel som arbetsyta i 3D

**Andringar i `src/components/viewer/InsightsDrawerPanel.tsx`:**

- Utoka panelens hojd fran 320px till 400px (eller gorbar resizable)
- BuildingInsightsView kors redan i drawerMode -- den visar flikar utan inline-viewer
- Nar anvandaren klickar pa diagram/rum i panelen uppdateras farglagningen i 3D-viewern direkt via sessionStorage + custom event

**Ny interaktionslank:**
- Fran BuildingInsightsView (i drawerMode) nar anvandaren klickar pa ett rum eller diagram-segment:
  - Istallet for att navigera (som pa standalone-sidan) dispatchar en CustomEvent `INSIGHTS_COLOR_UPDATE` med det nya colorMap
  - UnifiedViewer/AssetPlusViewer lyssnar pa detta event och uppdaterar farglagningen i realtid
  - Detta gor att anvandaren kan klicka runt i Insights-panelen och se rum tanda/slacka direkt i 3D ovanfor

**Teknisk implementation:**
```text
InsightsDrawerPanel (bottom sheet i 3D)
  --> BuildingInsightsView (drawerMode=true)
       --> Space-flik: klick pa rum -> dispatch INSIGHTS_COLOR_UPDATE
       --> FM-flik: klick pa "Visa i 3D" -> dispatch ALARM_ANNOTATIONS_SHOW
  
UnifiedViewer / AssetPlusViewer
  --> lyssnar pa INSIGHTS_COLOR_UPDATE -> applicera insightsColorMap
  --> lyssnar pa ALARM_ANNOTATIONS_SHOW -> tand annotations for angivna larm
```

---

### Filer som andras

| Fil | Andring |
|---|---|
| `src/components/insights/BuildingInsightsView.tsx` | 1) Byt "Larm"-flik till "FM", 2) Visa rumsnamn/nummer i alarmlistan, 3) Lagg till "Visa i 3D"-knappar, 4) Lagg till "Visa rum i 3D" i Space-fliken, 5) I drawerMode: dispatcha events istallet for navigate |
| `src/components/viewer/InsightsDrawerPanel.tsx` | Oka hojd, hantera events fran BuildingInsightsView |
| `src/components/viewer/AssetPlusViewer.tsx` | Lyssna pa `INSIGHTS_COLOR_UPDATE` event for att uppdatera farglagning i realtid |
| `src/lib/viewer-events.ts` | Lagg till nya event-namn: `INSIGHTS_COLOR_UPDATE`, `ALARM_ANNOTATIONS_SHOW` |

### Inga databasandringar

All data som behovs finns redan i `assets`-tabellen och `allData`-kontexten. Rum-lookup gors via allData (redan laddad). Inga nya edge functions.

