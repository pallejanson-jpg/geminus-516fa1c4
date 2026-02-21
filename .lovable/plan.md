
## Förbättringar av Xeokit 2D-läge

Sammanfattning av de förbättringar som behövs, uppdelade i fem delområden.

---

### 1. Bättre kontrast och fyllda väggar i 2D

**Problem**: Väggar visas som två tunna streck (konturerna av vägg-geometrin sedd ovanifrån). Kontrasten är låg.

**Lösning**: När 2D-läget aktiveras, applicera en 2D-specifik stil på scenen:
- Sätt `scene.edgeMaterial.edgeColor` till mörkt grå `[0.15, 0.15, 0.15]` och `edgeAlpha` till `1.0` för tydliga konturer
- Sätt `edgeWidth` till `2` för tjockare linjer
- Aktivera `entity.edges = true` på alla synliga väggar (`IfcWall`, `IfcWallStandardCase`)
- Applicera en mörkare `colorize` på väggar, t.ex. `[0.2, 0.2, 0.2]` med `opacity: 1.0` -- detta fyller väggarna med en mörk färg istället för att bara visa kanter
- Sänk ljusstyrkan på övriga objekt (dörrkarmar, fönster etc.) för att ge väggar prioritet

Vid byte tillbaka till 3D: återställ alla modifierade edge- och färgvärden (spara originalvärden i en ref, samma mönster som `hiddenFor2dRef`).

**Fil**: `src/components/viewer/ViewerToolbar.tsx` -- utöka `handleViewModeChange('2d')` med edge/color-logik

---

### 2. Room labels i 2D -- fast orientering

**Problem**: I ortho-vy (top-down) fungerar labels men de roterar inte med kameran om man panorerar/zoomar, och de kan bli svårlästa.

**Lösning**: I `useRoomLabels.ts`, när `viewModeRef.current === '2d'`:
- Stäng av `scaleWithDistance` (ortho har inget avståndsperspektiv)
- Stäng av `occlusionEnabled` (ovanifrån syns alla rum)
- Öka `fontSize` något (t.ex. 12px istället för 10px) för bättre läsbarhet i planvy
- Labels behöver ingen rotation-kompensation i ortho top-down med `up = [0,0,-1]` -- de visas redan rakt

Dessa 2D-specifika config-overrides appliceras automatiskt via `updateViewMode('2d')` som redan anropas.

**Fil**: `src/hooks/useRoomLabels.ts` -- lägg till 2D-specifika config-overrides i `updateViewMode`

---

### 3. Startposition per byggnad (2D och 3D)

**Problem**: Varje gång man öppnar en byggnad startar kameran från en generisk position. Användaren vill kunna spara en förvald kameraposition.

**Lösning**: Tabellen `building_settings` har redan en kolumn `start_view_id` (FK till `saved_views`). Flödet blir:

1. Användaren skapar en sparad vy (redan finns) och väljer den som "Startposition" i byggnads-inställningar
2. Vid laddning av viewern: hämta `start_view_id` från `building_settings`, ladda den sparade vyns kameradata, och applicera den som initialt kameraläge
3. Den sparade vyn innehåller redan `camera_eye`, `camera_look`, `camera_up`, `camera_projection`, `view_mode` och `clip_height`

**Filer**:
- `src/hooks/useBuildingViewerData.ts` -- hämta `start_view_id` och joinad vy-data
- `src/components/viewer/AssetPlusViewer.tsx` -- applicera startvy efter modell-laddning
- `src/components/settings/CreateBuildingPanel.tsx` eller `ViewerRightPanel.tsx` -- UI för att välja startvy

---

### 4. Kamerasynk vid byte mellan 2D och 3D

**Problem**: När man byter från 3D till 2D (eller tvärtom) hoppar kameran till en generisk position istället för att behålla platsen.

**Lösning**: I `handleViewModeChange`:
- **3D till 2D**: Spara nuvarande `camera.look` (XZ-planet). Beräkna ortho-kameran centrerad på samma XZ-position med `eye = [lookX, lookY + height, lookZ]`, `look = [lookX, lookY, lookZ]`, `up = [0, 0, -1]`. Beräkna `ortho.scale` från nuvarande avstånd (eye-to-look).
- **2D till 3D**: Spara nuvarande `camera.look` (center i planvyn). Placera perspektiv-kameran snett ovanför samma position med en rimlig vinkel (45 grader).

**Fil**: `src/components/viewer/ViewerToolbar.tsx` -- modifiera `handleViewModeChange` för att bevara position

---

### 5. Snittplan/Slicer-verktyget i 2D

**Status**: Slicer-verktyget (`useTool('slicer')`) skapar interaktiva snittplan via Asset+-API:et. Det fungerar tekniskt i 2D men kan konfliktera med de automatiska klippplanen (`applyFloorPlanClipping`).

**Rekommendation**: 
- Dölj slicer-knappen i toolbaren när `viewMode === '2d'` eftersom höjd-klippningen redan hanteras av `CLIP_HEIGHT_CHANGED_EVENT` via höjd-slidern i ViewerRightPanel
- Höjd-slidern i ViewerRightPanel styr redan `updateFloorCutHeight()` som justerar klipp-höjden i 2D -- den funktionen fungerar redan
- Visa slicer-knappen igen vid byte till 3D

**Fil**: `src/components/viewer/ViewerToolbar.tsx` -- villkorligt dölja slicer-knappen i 2D

---

### Implementationsordning

1. **Kontrast och fyllda väggar** -- Mest synlig förbättring, rent toolbar-tillägg
2. **Slicer i 2D** -- Liten ändring, dölj knappen
3. **Kamerasynk 2D/3D** -- Modifiera handleViewModeChange
4. **Room labels 2D-optimering** -- Justera useRoomLabels
5. **Startposition** -- Kräver DB-query + UI, mest arbete

### Filer som ändras

| Fil | Ändring |
|---|---|
| `src/components/viewer/ViewerToolbar.tsx` | Väggkontrast, slicer-döljning, kamerasynk |
| `src/hooks/useRoomLabels.ts` | 2D-specifika label-overrides |
| `src/hooks/useBuildingViewerData.ts` | Hämta start_view_id data |
| `src/components/viewer/AssetPlusViewer.tsx` | Applicera startvy vid laddning |
| `src/components/viewer/ViewerRightPanel.tsx` | UI för att välja startvy |
