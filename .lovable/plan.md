

## Plan: Förbättra navigerings-UX — steg-för-steg, riktningspilar och indoor-handoff

### Nuläge

Du har tre separata delar som inte är fullt sammankopplade:

| Komponent | Plats | Funktion |
|-----------|-------|----------|
| `NavigationMapPanel` | Kartvyn (Mapbox) | Välj från/till, profil, visa route summary |
| `MapView` | Kartvyn | Renderar outdoor-rutt som enkel linje, ingen riktningspil, ingen auto-zoom |
| `NavigationPanel` | 3D-viewern | Indoor rum-till-rum, graf-editor |
| `RouteDisplayOverlay` | 3D-viewern | SVG-overlay med animerad rutt |

**Problem:**
1. Route summary visar bara avstånd/tid — inga steg-för-steg-instruktioner (som MazeMap: "Gå 56 m → Gå ut från byggnaden → Kör 12.8 km")
2. Kartan zoomas till mittpunkten med fast zoom 13, inte anpassad till ruttens utsträckning (fitBounds)
3. Ingen riktningspil på ruttlinjen
4. Ingen tydlig "Visa i byggnaden"-knapp som tar användaren från kartan till 3D-viewern med indoor-rutten förberäknad

### Planerade ändringar

#### 1. Steg-för-steg-instruktioner i NavigationMapPanel
Bygga ut route summary-sektionen med en vertikal tidslinje likt MazeMap:
- Varje steg visar ikon (🚶/🚗/🚌), beskrivning, avstånd och tid
- Walking/driving-steg: parsas från Mapbox Directions `steps[]` (som redan returneras men inte skickas till UI)
- Transit-steg: redan tillgängliga via `transitSteps`
- Indoor-steg: "Gå inomhus ~X m" + eventuella våningsbyten
- Total sammanfattning överst: "Föreslagen väg ⏱ 16 min"

**Filer:** `NavigationMapPanel.tsx`, `MapView.tsx` (skicka steps-data), `mapbox-directions/index.ts` (redan returnerar steps)

#### 2. Auto-zoom med fitBounds
Ersätta det fasta `zoom: 13` med Mapbox `fitBounds` som anpassar kartan till ruttens hela utsträckning med padding.

**Fil:** `MapView.tsx` — beräkna bbox från ruttens koordinater och anropa `mapRef.current.fitBounds()`

#### 3. Riktningspilar på ruttlinjen
Lägga till en symbol-layer med pilikoner längs ruttlinjen (Mapbox `symbol` layer med `symbol-placement: 'line'`), liknande MazeMap-bilden.

**Fil:** `MapView.tsx` — lägg till en extra Layer med `>` symboler, roterade längs linjen

#### 4. Start/slut-markörer (A/B)
Lägga till Mapbox-markörer med A och B vid ruttens ändpunkter.

**Fil:** `MapView.tsx` — rendera `<Marker>` komponenter för origin och destination

#### 5. "Visa i byggnaden"-knapp (outdoor → indoor handoff)
När en rutt med indoor-del har beräknats, visa en knapp i route summary som:
1. Sparar indoor-rutten i `sessionStorage` (`pending_indoor_route`)
2. Navigerar till 3D-viewern (`/viewer`) med byggnads-GUID
3. Viewern läser pending route och visar `RouteDisplayOverlay` automatiskt

**Filer:** `NavigationMapPanel.tsx` (knapp), `MapView.tsx` (spara och navigera)

### Teknisk sammanfattning

```text
NavigationMapPanel
├── Steg-tidslinje (ny)
│   ├── 🚶 Gå 56 m — 1 min
│   ├── 🚌 Buss 3 Centrum → Skutberget — 8 min
│   ├── 🚶 Gå 200 m — 3 min
│   └── 🏢 Inomhus ~45 m (2 våningsbyten)
├── [Visa i byggnaden] → sessionStorage → /viewer
└── Total: 2.3 km · 16 min

MapView
├── Route layer + symbol layer (riktningspilar)
├── A/B markers
└── fitBounds() istället för fast zoom
```

### Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/components/map/NavigationMapPanel.tsx` | Steg-för-steg-tidslinje, "Visa i byggnaden"-knapp, utökad props |
| `src/components/map/MapView.tsx` | fitBounds, riktningspilar, A/B-markörer, skicka steps till panel |
| `supabase/functions/mapbox-directions/index.ts` | Säkerställ att `steps` returneras (kontrollera befintlig implementation) |

