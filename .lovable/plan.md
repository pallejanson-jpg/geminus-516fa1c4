

## ✅ GENOMFÖRD: Lazy-loading 3D, Alarm-annotations via rum-BIM, BIM-modellnamn

### 1. ✅ Lazy-load 3D i Insights
- `AssetPlusViewer` laddas via `React.lazy()` — ingen 3D-motor laddas förrän användaren klickar på ett diagram
- Platshållare visas innan: "Klicka på ett diagram för att visa i 3D"

### 2. ✅ Alarm-annotations via rum-BIM
- `AlarmAnnotationsShowDetail` uppdaterad: `roomFmGuid` istället för `x/y/z`
- `BuildingInsightsView` skickar `in_room_fm_guid` i alla alarm-events
- `AssetPlusViewer` handler slår upp rum-entities i BIM, flashar dem, och gör `viewFit` med AABB

### 3. ✅ BIM-modellnamn
- SQL-fix: Småvikens modeller namnsatta (A-modell, KV-modell) i `xkt_models`
- Diagnostik-loggning tillagd i Strategy 6-8 i `ModelVisibilitySelector`
