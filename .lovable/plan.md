

## Plan: Slutföra indoor-navigering — steg-visning i 2D-kartan

### Nuläge

Idag fungerar outdoor-navigeringen (steg, riktningspilar, fitBounds). "Visa i byggnaden" öppnar 3D-viewern. Men det saknas:

1. **Indoor-steg i steglistan** — idag visas bara "Gå inomhus ~X m" som ett enda steg. MazeMap visar faktiska svängar och korridorer ("Sväng höger", "Ta trappan till plan 3" etc.)
2. **Indoor-rutt på 2D-kartan** — MazeMap renderar indoor-rutten direkt i kartlagret, inte bara i 3D. Ni har redan `useIndoorGeoJSON` och `IndoorFloorSwitcher` men de används bara för planritningar, inte ruttvisning
3. **Automatisk indoor-rutt vid "Visa i byggnaden"** — `pending_indoor_route` sparas men viewern läser aldrig upp den

### Planerade ändringar

#### 1. Generera detaljerade indoor-steg från Dijkstra-rutten
**Fil:** `src/lib/pathfinding.ts`
- Ny funktion `generateIndoorSteps(route: RouteResult, graph: NavGraph)` som itererar path-noderna och genererar textinstruktioner:
  - Vinkeländringar >30° → "Sväng vänster/höger"
  - Nodtyp `stairwell`/`elevator` → "Ta trappan/hissen till våning X"
  - Raka sträckor → "Gå rakt ~X m"
- Varje steg inkluderar koordinater för klickbarhet

#### 2. Visa indoor-rutt som GeoJSON-lager i MapView
**Fil:** `src/components/map/MapView.tsx`
- När indoor-rutt finns: konvertera waypoint-koordinater (normaliserade %) till geo-koordinater via `localToGeo` med byggnadens origin
- Rendera som en extra `Source`/`Layer` med streckad linje ovanpå planritningen
- Samma riktningspilar som outdoor-rutten

#### 3. Koppla indoor-steg till StepTimeline
**Fil:** `src/components/map/NavigationMapPanel.tsx`
- Ersätt det statiska "Gå inomhus ~X m"-steget med de genererade detaljerade stegen
- Varje indoor-steg klickbar → flyTo på kartan (kräver geo-koordinater)

#### 4. Läs `pending_indoor_route` i viewern
**Fil:** `src/components/viewer/NativeViewerShell.tsx`
- Vid mount: kolla `sessionStorage.getItem('pending_indoor_route')`
- Om den finns: parsa, beräkna Dijkstra-rutt, visa `RouteDisplayOverlay`
- Rensa `sessionStorage` efter konsumtion

### Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/lib/pathfinding.ts` | Ny `generateIndoorSteps()` — detaljerade svänginstruktioner |
| `src/components/map/MapView.tsx` | Indoor-rutt som GeoJSON-lager på kartan |
| `src/components/map/NavigationMapPanel.tsx` | Detaljerade indoor-steg i timeline |
| `src/components/viewer/NativeViewerShell.tsx` | Läs `pending_indoor_route` och visa rutt |

### Beroenden

Indoor-ruttvisning på kartan kräver att:
- Byggnaden har en sparad `building_origin` (lat/lng/rotation) i `building_settings` — behövs för att konvertera % → geo
- En navigationsgraf finns sparad i `navigation_graphs`

Om dessa saknas visas outdoor-rutten som vanligt utan indoor-del.

