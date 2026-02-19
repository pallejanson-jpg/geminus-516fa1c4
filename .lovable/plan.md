

## Analys och atergarder: 3D-laddning, annotations, vaningstal, sensor/space-konsolidering

### Problem 1: Annotation-laddning tar 2+ minuter

**Rotorsak identifierad:**
I `loadAlarmAnnotations` (AssetPlusViewer.tsx rad 1516-1548) gors en linjar sokning for varje alarm:

```text
alarms.forEach(alarm => {
  const metaObj = Object.values(metaObjects).find(m =>
    (m.originalSystemId || m.id)?.toUpperCase() === alarm.fm_guid?.toUpperCase()
  );
});
```

Med 1000 alarm och potentiellt 50 000+ metaObjects blir detta ~50 miljoner jamforelser. Loggen visar 2 minuter fran "Found 1000 alarm assets" till "Found 0 alarm annotations" -- all tid gar at till denna loop.

**Fix:** Bygg en uppslagningsmapp (`Map<string, metaObject>`) FORE loopen. Det reducerar O(n*m) till O(n+m) -- fran minuter till millisekunder.

---

### Problem 2: "13 vaningar" -- felaktig rakning

**Rotorsak:** Smavikenbyggnaden har 13 Building Storey-poster i databasen, men manga ar dubbletter fran olika modeller:
- `01` (1 st)
- `04 - 01` (1 st)
- `05 - 01`, `05 - 02` (samma vaning, tva modeller)
- `06 - 01`, `06 - 02` (samma vaning, tva modeller)
- `FLAKTRUM - 01`, `FLAKTRUM - 02` (samma, tva modeller)
- `TAKPLAN - 02` (1 st)
- `Base Level` (1 st)
- 3 utan namn (null)

**Fix:** Deduplicera vaningar baserat pa `common_name`-prefix (ta bort " - 01", " - 02" suffix) och raekna unika. Det ger ~7 unika vaningsplan istallet for 13.

Andring i `stats`-berakningen (rad 362):
```text
// Nuvarande: floorCount: buildingStoreys.length (= 13)
// Ny: deduplicate by common_name prefix
const uniqueFloors = new Set(buildingStoreys.map(s =>
  (s.commonName || s.fmGuid).replace(/\s*-\s*\d+$/, '')
));
floorCount: uniqueFloors.size
```

---

### Problem 3: "Visa rum i 3D" pa fel flik och for stor

**Nuvarande:** Knappen ligger pa Space-fliken (rad 710-743) som ett eget Card-block.

**Fix:** Flytta knappen till Sensors-fliken (som snart integreras i Space-fliken -- se nedan), inline med "Rumsheatmap"-rubriken. Minska fran eget Card till en liten knapp pa samma rad som rubriken.

---

### Problem 4: Sensor-fliken ska slas ihop med Space-fliken

**Atgard:**
1. Flytta sensorinnehallet (rumsheatmap, trend-diagram, metrik-valjare, LIVE-badge) in i Space-fliken, nedanfor befintligt rum-typdiagram
2. Ta bort "Sensorer"-tabben fran TabsList
3. Placera "Visa rum i 3D"-knappen inline med "Rumsheatmap"-rubriken (liten, samma hojd)
4. Rumsheatmap visar 60 rum med en kommentar om att byggnaden har 555 totalt

---

### Problem 5: Sensorer for icke-rumobjekt pa Asset-fliken

**Atgard:** Pa Asset-fliken, lagg till en sektion "Tillgangs-sensorer" som visar sensordata for objekt av kategori "Instance" (kategori 4) som har Senslinc-koppling. Dessa ar maskiner/installationer som inte tillhor rum.

---

### Problem 6: XKT-laddtider -- cachestrategi

Konsolloggarna visar att cachade modeller ar korrupta (0 bytes) och faller igenom till ny nedladdning. Edge-funktionen `xkt-cache` far "Memory limit exceeded". Modellerna ar 41-53 MB styck, totalt ~150 MB i minnet.

Cachen fungerar korrekt for modeller som ar inladdade (`XKT Memory: Stored`) men edge-funktionens uppladdning misslyckas (`FunctionsHttpError`, `FunctionsFetchError`, auth lock timeouts). Det innebar att modeller aldrig sparas i backend-cachen -- de hamtas fran Asset+ varje gang.

**Detta ar ett separat problem** -- edge-funktionens minnesgrans ar for lag for 53 MB XKT-filer. Plan: lagga till chunked upload eller skippa edge-funktionen for stora filer och ladda upp direkt till Storage fran klienten. (Behandlas separat.)

---

### Filer som andras

| Fil | Andring |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | Bygg Map-lookup for metaObjects FORE alarm-loopen (fixar 2-min hang) |
| `src/components/insights/BuildingInsightsView.tsx` | 1) Deduplicera vaningstal, 2) Flytta sensorinnehall till Space-fliken, 3) Ta bort Sensors-tabben, 4) Placera "Visa rum i 3D" inline med Rumsheatmap-rubrik |
| `src/components/insights/tabs/SensorsTab.tsx` | Ingen -- filen kan ligga kvar som standalone men anvands inte langre fran BuildingInsightsView |

### Ingen databasandring

All data finns redan. Deduplicering och sammanslagning sker i frontend-logik.

### Prioritetsordning

1. **Annotation-fix** -- storst prestandaproblem, fixar 2-minuters hang
2. **Vaningstal-deduplicering** -- enkel fix, en rad
3. **Sensor+Space ihopslagning** -- storre UI-refaktor men isolerad till BuildingInsightsView
4. **"Visa rum i 3D" flytt** -- del av punkt 3
5. **Tillgangs-sensorer pa Asset** -- ny sektion, laggs till sist
