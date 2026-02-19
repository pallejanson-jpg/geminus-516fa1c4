

## Forbattringar av Insights, FM-grid, vaningsnamn och BIM-modellnamn

### Problem och losningar

---

### 1. Demo-skylt i rumsmeny (RoomSensorDetailSheet)

**Problem:** Nar man klickar pa ett rum i Space-fliken oppnas en `RoomSensorDetailSheet` till hoger. Den visar "Demo"-badge nar ingen live-data finns fran Senslinc. Sensordata ar mockad -- inte riktiga varden.

**Losning:** Ingen andring -- detta ar korrekt beteende. Badgen visar "Demo" nar ingen Senslinc-koppling finns, "LIVE" nar det finns. Datan som visas i demo-laget ar genererad av `generateMockSensorData()`.

---

### 2. Vaningsfilter pa Space-fliken

**Problem:** Heatmapen visar 60 rum utan mening -- det ar `buildingSpaces.slice(0, 60)`, dvs de forsta 60 oavsett vaning. Smavikenbyggnaden har 555 rum.

**Losning:** Lagg till vaningsfilter (pills) ovanfor rumsheatmapen, precis som pa FM-sidan med larm. Anvand `buildingStoreys` och `levelNames`-map for att bygga filterknappar. Filtrera `sensorRooms` pa `levelFmGuid` nar en vaning ar vald. Standard: visa alla (men begransa till 60).

**Andringar i `BuildingInsightsView.tsx`:**
- Lagg till state `spaceFloorFilter: string` (tom = alla)
- Bygg vaningschips fran `buildingStoreys` (deduplicated)
- Filtrera `sensorRooms` via `spaceFloorFilter` fore `.slice(0, 60)`
- Visa "X av Y rum pa denna vaning" i description

---

### 3. FM-grid: sok, filtrering, tooltips

**Problem:** Larm-griden saknar sok/filter-funktion och tooltips pa knappar.

**Losning:**
- Lagg till en sokruta ovanfor tabellen (sok pa rumsnamn, rumsnummer, vaning)
- Lagg till `title`-attribut (tooltip) pa oga-knappen ("Visa annotation och zooma till larm") och radera-knappen ("Radera larm")
- Andringen pa oga-knappen: nar man klickar ska den 1) tanda en annotation, 2) zooma till larmet -- INTE navigera till fullskarmsvy

**Andringar:**
- State `alarmSearch: string` for sokning
- Filtrera `alarmList` pa rumsnamn/rumsnummer/vaningsnamn
- Lagg till `title` pa bada knappar i tabellen

---

### 4. Fel vaningsnamn "38591717" i griden

**Problem:** 3 vaningar i databasen har `common_name = NULL` och `name = NULL`. Nar `levelNames.get(guid)` misslyckas, visas fallback `alarm.level_fm_guid.slice(0, 8)` = "38591717".

**Rotorsak:** Dessa 3 vaningar (fm_guid: `38591717-...`, `15c10118-...`, `b78f0b93-...`) saknar namn i databasen. De har 10 800+ larm tilldelade.

**Losning:** Forbattra fallback-logiken: for vaningar utan namn, visa "Vaning (okand)" istallet for ett avhugget GUID. I `levelNames`-builden, satt namnlosa vaningar till ett lampligt default-namn baserat pa position i listan.

---

### 5. Karusellen med namnlosa vaningar

**Problem:** Samma 3 namnlosa vaningar (`common_name = NULL`) dyker upp i `FloorCarousel` utan namn. De hamtas fran metaScene dar `metaObject.name` ocksa kan vara ett GUID.

**Losning:** I `FloorCarousel.extractFloors()` -- filtrera bort vaningar vars `name` matchar ett GUID-monster (36 tecken med bindestreck) ELLER ar "Unknown Floor". Om de har rum under sig, slapp igenom men visa "Vaning X" som fallback.

---

### 6. "Antal IfcAlarm per vaning" -- byt text

**Problem:** Texten "Antal IfcAlarm per vaning" ar for teknisk.

**Losning:** Byt `CardDescription` till "Antal alarm per vaning (riktiga data)".

---

### 7. Annotation-knapp brevid stapel i larm-diagrammet

**Problem:** Anvandaren vill kunna tanda annotations for larm pa en specifik vaning genom att klicka pa en knapp brevid varje stapel.

**Losning:** Lagg till en annotation-ikon (MapPin) brevid varje stapel i BarChart. Implementeras med en custom `renderBar`-komponent eller en separat kolumn med knappar bredvid diagrammet. Klick dispatchar `ALARM_ANNOTATIONS_SHOW_EVENT` med alla larm for den vaningen.

**Implementation:** Anvand en kombinerad layout -- visa en liten lista med vaningsnamn + antal + annotation-knapp brevid diagrammet, alternativt en `onBarClick`-handler som hamtar larm for vaningen och dispatchar event.

---

### 8. Klicka pa stapel -> filtrera griden

**Problem:** Nar man klickar pa en stapel i "Larm per vaningsplan" ska griden filtreras till den vaningens larm.

**Losning:**
- Lagg till state `alarmLevelFilter: string` (tom = alla)
- Klick pa stapel satter `alarmLevelFilter` till den vaningens `levelGuid`
- Filtrera `alarmList` pa `alarmLevelFilter`
- Visa en "Visa alla"-knapp for att nollstalla filtret

---

### 9. Roda knappen (Trash2) -- tooltip

**Problem:** Den roda knappen (Trash2-ikonen) saknar forklaring.

**Losning:** Den gor redan `.delete()` -- larmet raderas. Lagg till `title="Radera larm"` for att gora det tydligt.

---

### 10. Oga-knappen -- tanda annotation + zoom

**Problem:** Oga-knappen navigerar for narvarande till 3D-viewern (fullskarm). Anvandaren vill att den istallet tander en annotation och gora zoom-to utan att byta vy.

**Losning:** I `drawerMode` (redan korrekt -- dispatchar event). I icke-drawerMode: andra fran `navigateTo3D({ entity: ... })` till att dispatcha `ALARM_ANNOTATIONS_SHOW_EVENT` med koordinater + ett `flyTo`-flag som AssetPlusViewer hanterar.

---

### 11. Vaningstal-KPI klickbar med valjare

**Problem:** Klickar man pa "Floors"-KPIn (t.ex. "7") ska en vaningsvaljare visas.

**Losning:** Gor Floors-KPIn klickbar -- vid klick visa en Popover med lista over vaningar. Val av vaning navigerar till Insights med vaningsfilter aktivt (scrollar till Space-fliken med ratt filter).

---

### 12. BIM-modellnamn i visningsmenyn

**Problem:** Modellnamn visas som GUIDs eller filnamn istallet for vanliga namn (t.ex. "A-modell").

**Rotorsak:** `useModelNames`-hooken hamtar fran `xkt_models`-tabellen + Asset+ API. Matching misslyckas nar modell-ID:t i scenen inte matchar nyckeln i databasen.

**Losning:** Forbattra matchningslogiken i `ModelVisibilitySelector.extractModels()`:
- Lagg till Strategy 7: matcha baserat pa `IfcProject`-namn fran metaScene mot databasens modellnamn (redan delvis implementerat som Strategy 6)
- Sakerstall att `xkt_models`-tabellen har korrekta `display_name`-varden for Smavikens modeller

**Forst: verifiera data i xkt_models:**

---

### Filer som andras

| Fil | Andring |
|---|---|
| `src/components/insights/BuildingInsightsView.tsx` | 1) Vaningsfilter pa Space-tab, 2) Sok+filter i FM-grid, 3) Tooltips pa knappar, 4) Byt "IfcAlarm" till "Alarm", 5) Annotation-knapp per stapel, 6) Stapelklick filtrerar grid, 7) Oga-knapp = annotation+zoom utan navigation, 8) Floors-KPI klickbar med valjare, 9) Fallback for namnlosa vaningar |
| `src/components/viewer/FloorCarousel.tsx` | Filtrera bort GUID-namngivna vaningar |
| `src/components/viewer/ModelVisibilitySelector.tsx` | Forbattrad namnmatchning -- verifiera och fixa Strategy 6 |
| `src/hooks/useModelNames.ts` | Eventuell forbattring av fallback-namn |

### Ingen databasandring

All data finns redan. Namnlosa vaningar ar en datakvalitetsfraga fran Asset+ -- losen ar forbattrad fallback-hantering i frontend.

### Prioritetsordning

1. Vaningsnamn-fix (fallback for null-namn) -- paverkar bade karusell, chart och grid
2. FM-grid forbattringar (sok, filter, tooltips, stapelklick)
3. Vaningsfilter pa Space-tab
4. Annotation-knapp i diagrammet
5. Oga-knapp beteende (annotation+zoom istallet for navigation)
6. Floors-KPI klickbar
7. BIM-modellnamn -- verifiering + fix
