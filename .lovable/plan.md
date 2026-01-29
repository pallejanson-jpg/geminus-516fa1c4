# Plan: Aktivera Alarm-annotationer och fixa klippning/rumssynlighet

## Status: ✅ IMPLEMENTERAT

Alla fyra delar av planen har implementerats:

### Del 1: Alarm-annotationer ✅
- Ny `loadAlarmAnnotations()` funktion i `AssetPlusViewer.tsx` som:
  - Hämtar IfcAlarm-objekt från databasen (max 1000 för prestanda)
  - Slår upp deras position via BIM-geometri (metaScene → entity.aabb)
  - Skapar markörer med Alarm-symbolens färg och ikon
  - Bulk-uppdaterar symbol_id för alarm som saknar det
- `AnnotationCategoryList.tsx` uppdaterad för att inkludera `IfcAlarm` i queryn

### Del 2: 2D klipphöjd-slider ✅
- Korrigerat SectionPlane direction i `useSectionPlaneClipping.ts`:
  - 2D floor mode: `dir: [0, 1, 0]` (pekar UPP = klipper allt OVANFÖR planet)
  - 3D ceiling mode: `dir: [0, -1, 0]` (pekar NER = klipper vid taknivå)
- Alla platser uppdaterade: `applySectionPlane`, `applyGlobalFloorPlanClipping`, `updateFloorCutHeight`

### Del 3: 3D Solo-mode klippning ✅
- Befintlig logik i `calculateClipHeightFromFloorBoundary` använder nästa vånings `minY`
- 3D ceiling mode behåller `dir: [0, -1, 0]` för korrekt beteende

### Del 4: Visa rum alltid AV ✅
- `handleAllModelsLoaded` forcerar nu spaces OFF på två nivåer:
  1. Via Asset+ API: `assetViewer.onShowSpacesChanged(false)`
  2. Direkt på xeokit: Itererar alla IfcSpace och sätter `visible = false`
- Loggning för att bekräfta antal dolda rum

## Filändringar

| Fil | Ändringar |
|-----|-----------|
| `src/components/viewer/AssetPlusViewer.tsx` | Ny `loadAlarmAnnotations`, förbättrad spaces-döljarlogik |
| `src/components/viewer/AnnotationCategoryList.tsx` | Query inkluderar nu IfcAlarm |
| `src/hooks/useSectionPlaneClipping.ts` | Korrigerad `dir`-vektor för 2D vs 3D |

## Tekniska detaljer

### xeokit SectionPlane beteende
xeokit documentation: "Discards elements from the half-space in the direction of `dir`"

- `dir: [0, 1, 0]` = pekar uppåt → klipper allt **ovanför** planet (för 2D-planritning)
- `dir: [0, -1, 0]` = pekar neråt → klipper allt **i neråtriktningen** (för 3D ceiling-klipp)

### Alarm-annotations
- Positioner hämtas från BIM-geometri via `entity.aabb` (bounding box centrum)
- Begränsat till 1000 alarm per byggnad för prestanda
- Symbol_id uppdateras automatiskt för alarm som saknar det
