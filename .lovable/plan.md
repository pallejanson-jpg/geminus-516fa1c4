

## Plan: Fix 3 Viewer-buggar — Småviken-laddning, Våningsklippning, 2D-läge

### Problem 1: Småviken laddar extremt långsamt / aldrig

**Orsak:** Varje modell gör en `HEAD`-request mot `_metadata.json` i storage för att kolla om det finns en separat metadata-fil. För byggnader med många modeller (Småviken har troligen 10+) blir detta 10+ extra nätverksanrop som körs **sekventiellt** inuti `loadModel()`. Dessutom fallerar dessa HEAD-requests med 4xx/timeout men fångas tyst — varje sån timeout fördröjer med sekunder.

**Fix i `NativeXeokitViewer.tsx`:**
- Flytta metadata-kontrollen till en batch-operation: gör ett enda `storage.list()` för att hitta alla `_metadata.json`-filer i mappen, FÖRE modelladdningsloopen
- I `loadModel()` — slå upp i den förhämtade listan istället för individuella HEAD-requests
- Detta eliminerar N nätverksanrop och tar bort den flaskhals som gör att Småviken hänger sig

---

### Problem 2: Våningsväljaren klipper objekt för kort i 3D

**Orsak:** `applyCeilingClipping()` sätter klippplanet vid `nextFloor.minY` — dvs exakt vid golvkant av nästa våning. Objekt som sticker upp genom bjälklaget (rör, pelare, väggar) klipps vid det planet. Men användaren vill att klippningen ska ske vid **takbjälklagets underkant** av den valda våningen, inte vid nästa vånings golvkant.

Problemet är att `calculateClipHeightFromFloorBoundary` returnerar `nextFloor.minY` vilket ofta är ca 0.2m lägre än den valda våningens `maxY` (bjälklaget). Objekt som sträcker sig precis till bjälklaget ser avhuggna ut.

**Fix i `useSectionPlaneClipping.ts` → `applyCeilingClipping()`:**
- Ändra klipphöjden till `currentFloor.maxY` istället för `nextFloor.minY` — detta klipper vid den valda våningens tak (bjälklagsöverkant), inte vid nästa vånings golv
- Om `currentFloor.maxY` och `nextFloor.minY` överlappar (bjälklaget delas), ta `min(currentFloor.maxY, nextFloor.minY)` med en liten offset (+0.05m) för att inkludera objekt som ansluter bjälklaget
- Detta matchar beteendet som `cutOutFloorsByFmGuid` ger i Asset+Viewer

---

### Problem 3: 2D-läget visar INGENTING

**Orsak:** `handleViewModeChange('2d')` i ViewerToolbar gör tre saker:
1. Sätter klippplan (top + bottom) via `applyFloorPlanClipping`
2. Färgar om alla entiteter (väggar svarta, slabs transparenta, etc.)
3. Byter till ortografisk kamera ovanifrån

Problemet: `applyFloorPlanClipping` sätter `topClipY = bounds.minY + floorCutHeight` (1.2m). Men steg 2 sätter `entity.opacity = 0` på slabs, `entity.visible = true` på allt annat. **Om klippplanen inte fungerar korrekt** (SectionPlane-creation misslyckas tyst) så syns fortfarande objekt. Men om de LYCKAS och klipper vid 1.2m + golvet, och sedan styling sätter golv/bjälklag till opacity 0, kan resultatet bli att allt klipps bort.

Det troliga problemet: `createSectionPlane` lyckas skapa planen via `__xeokitSectionPlaneClass` (exponerad av NativeViewer), men `dir`-vektorn [0, -1, 0] för bottom-planet klipper bort **allt under golvplanet** — och sedan klipper top-planet vid 1.2m ovanför golvet. Kombinerat med att slabs (golvet) sätts till opacity 0 ser det ut som att **ingenting** syns.

**Fix — omskriven 2D-logik i `ViewerToolbar.tsx`:**

1. **Ta bort bottom-klippplanet** — i 2D-läge behövs bara ett tak-klippplan. Väggar och andra objekt som sträcker sig nedåt ska fortfarande synas. Bottom-planet klipper bort golvet och allt under → tom vy.
2. **Använd bara ett topplane** vid `bounds.minY + floorCutHeight` (0.5m enligt användarens önskemål)
3. **Ändra default `floorCutHeight`** från 1.2 till 0.5 i `useSectionPlaneClipping` options
4. **Säkerställ att väggar visas** — nuvarande logik sätter opacity 1 på väggar men klippar vid 0.5m → väggar syns bara 0.5m upp från golvet, vilket ger en tydlig planritningsvy
5. **Fallback**: om `applyFloorPlanClipping` inte skapar planer (null return), hoppa direkt till att visa allt utan klippning och logga ett tydligt felmeddelande

**Ny approach för `applyFloorPlanClipping` vid 2D:**
- Ändra funktionen att acceptera en `skipBottomPlane` parameter
- I 2D-läge: skapa bara topplane, inte bottomplane
- Alternativt: skapa en separat `apply2DFloorClipping(floorId)` som bara skapar topplane

---

### Sammanfattning

| Fil | Ändring |
|---|---|
| `NativeXeokitViewer.tsx` | Batch metadata-check med `storage.list()` istället för per-model HEAD requests |
| `useSectionPlaneClipping.ts` | Ändra `applyCeilingClipping` att använda `currentFloor.maxY` + offset. Lägg till `apply2DTopOnlyClipping` som bara skapar topplane utan bottomplane. Default `floorCutHeight` → 0.5 |
| `ViewerToolbar.tsx` | I 2D-läget: använd `apply2DTopOnlyClipping` (bara topplane). Ta bort bottom-planet som klipper bort golvet. Justera default höjd till 0.5m |

