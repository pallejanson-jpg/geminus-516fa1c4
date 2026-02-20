

## Fix: Lazy-loading 3D, Alarm-annotations via rum-BIM, BIM-modellnamn

### 1. Lazy-load 3D i Insights (stoppa blockeringen)

`BuildingInsightsView.tsx` importerar `AssetPlusViewer` direkt, vilket tvingar webblasaren att ladda hela 3D-motorn nar Insights oppnas -- innan anvandaren ens sett ett diagram.

**Losning:**
- Byt `import AssetPlusViewer from '...'` till `const AssetPlusViewer = React.lazy(() => import(...))`
- Wrappa `InsightsInlineViewer` med `<Suspense fallback={<Spinner />}>`
- Villkora montering: rendera `AssetPlusViewer` BARA nar `inlineInsightsMode` har ett varde (anvandaren har klickat pa ett diagram)
- Fore det visas en platshallare med text "Klicka pa ett diagram for att visa i 3D"
- Diagram och staplar renderas omedelbart utan att vanta pa 3D-motorn

**Effekt:** Insights-sidan oppnas direkt. Diagram och KPI:er visas pa millisekunder. 3D laddas forst vid behov.

---

### 2. Alarm-annotations -- korrekt flode via rum-BIM

**Faktisk datamodell (verifierad mot databasen):**
- IfcAlarm har INGA egna koordinater (`coordinate_x/y/z = null`)
- IfcAlarm HAR en `in_room_fm_guid` (relation till rummet de tillhor)
- Rummen (IfcSpace) har OCKSA `null` koordinater i databasen
- MEN rummen har BIM-geometri i 3D-viewern (de ar IfcSpace-objekt med bounding boxes)

**Korrekt flyTo-flode:**

1. Hamta alarmets `in_room_fm_guid` fran databasen
2. I 3D-viewern: hitta rummets entities via `getItemsByPropertyValue("fmguid", roomFmGuid)`
3. Berakna rummets centrum fran dess bounding box (AABB) i 3D-scenen
4. Flyga kameran dit med `viewFit` pa rummets entities
5. Placera en DOM-annotation mitt i rummets bounding box

**Implementering i `AssetPlusViewer.tsx` (ALARM_ANNOTATIONS_SHOW_EVENT-handler):**

```text
Nuvarande (trasig):
  - Tar emot { alarms: [{ fmGuid, x, y, z }], flyTo }
  - x/y/z ar alltid null/0
  - Forsoker flasha entity via alarm-fmGuid (hittar inget i BIM)

Nytt flode:
  1. For varje alarm: sla upp in_room_fm_guid (redan hamtat i BuildingInsightsView)
  2. For varje unikt rum: hitta BIM-entities och berakna AABB-centrum
  3. Skapa DOM-annotation vid centrum
  4. Om flyTo=true: viewFit pa ALLA berorda rums entities
```

**Andring i `BuildingInsightsView.tsx` (event dispatch):**

Skicka `in_room_fm_guid` med i event-detail istallet for (tomma) koordinater:

```text
Nuvarande:
  alarms.map(a => ({ fmGuid: a.fm_guid, x: a.coordinate_x, y: a.coordinate_y, z: a.coordinate_z }))

Nytt:
  alarms.map(a => ({ fmGuid: a.fm_guid, roomFmGuid: a.in_room_fm_guid }))
```

**Andring i `viewer-events.ts`:**

Uppdatera `AlarmAnnotationsShowDetail`:
```text
Nuvarande: { fmGuid: string; x: number; y: number; z: number }[]
Nytt: { fmGuid: string; roomFmGuid: string }[]
```

---

### 3. BIM-modellnamn -- databasfix + diagnostik

**Omedelbar fix (SQL):**

Uppdatera `xkt_models`-tabellen med ratta namn for Smaviken. For att veta exakt vilka modeller som finns, behover vi kolla tabellen och satta ratt namn.

**Diagnostik i `ModelVisibilitySelector.tsx`:**

Lagg till `console.log` i Strategy 6-8 som ALLTID loggar -- inte bara vid matchning:
- Logga alla metaModels-nycklar
- Logga alla IfcProject-objekt som hittas
- Logga matchningsresultat

Detta ger oss data for att fixa Strategy 8 korrekt i nasta iteration.

---

### Filer som andras

| Fil | Andring |
|---|---|
| `src/components/insights/BuildingInsightsView.tsx` | 1) React.lazy for AssetPlusViewer, 2) Villkorad montering, 3) Skicka roomFmGuid istallet for koordinater i event |
| `src/components/viewer/AssetPlusViewer.tsx` | Skriv om ALARM_ANNOTATIONS_SHOW_EVENT-handler: sla upp rum-BIM, berakna AABB-centrum, skapa DOM-annotation, viewFit |
| `src/lib/viewer-events.ts` | Uppdatera AlarmAnnotationsShowDetail med roomFmGuid istallet for x/y/z |
| `src/components/viewer/ModelVisibilitySelector.tsx` | Lagg till diagnostik-loggning i Strategy 6-8 |
| SQL (databasfix) | Uppdatera model_name for Smavikens modeller i xkt_models |

### Prioritetsordning

1. **Lazy-load 3D** -- omedelbar prestandaforabttring, enkel andring
2. **Alarm-annotations via rum-BIM** -- korrekt flyTo + visuella markeringar
3. **BIM-modellnamn** -- databasfix + diagnostik for framtida forbattring
