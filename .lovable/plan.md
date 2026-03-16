

# Plan: Kollektivtrafik via Google Routes API + Steg-för-steg + Indoor-handoff

## Översikt

Du har redan Google API-nycklar. Google Routes API (tidigare Directions API) stöder `TRANSIT` med bussar, tåg, tunnelbana etc. Vi skapar en ny edge function som anropar Google Routes API parallellt med den befintliga Mapbox-funktionen, och lägger till en Transit-knapp i NavigationMapPanel.

## Steg

### 1. Spara Google API-nyckel som secret
- Använda `add_secret` för att lagra `GOOGLE_MAPS_API_KEY`

### 2. Ny edge function: `google-directions/index.ts`
- Anropar Google Routes API (`https://routes.googleapis.com/directions/v2:computeRoutes`)
- Skickar `travelMode: "TRANSIT"` med `origin`/`destination` som lat/lng
- Returnerar: `geometry` (polyline avkodad till GeoJSON), `distance`, `duration`, `steps` (med transit-detaljer som linjenummer, bytespunkter), och `transitDetails` (avgångstid, linje, typ)
- CORS + auth enligt befintligt mönster

### 3. Uppdatera `NavigationMapPanel.tsx`
- Lägg till en tredje profil-knapp: 🚌 Transit (ikon: `Bus` från lucide)
- `profile`-typen utökas till `'walking' | 'driving' | 'transit'`
- `onNavigate`-propens interface uppdateras med den nya profilen
- Vid transit: visa extra info i route summary — linjenummer, byten, avgångstid

### 4. Uppdatera `MapView.tsx` — `handleNavigate`
- Om `profile === 'transit'`: anropa `google-directions` istället för `mapbox-directions`
- Avkoda Google polyline till GeoJSON-koordinater för kartvisning
- Spara `steps` (med transitinfo) i state

### 5. Steg-för-steg outdoor-instruktioner i NavigationMapPanel
- Visa `steps` från antingen Mapbox eller Google i en expanderbar lista under route summary
- Varje steg visar ikon (sväng/buss/tåg), instruktion, avstånd
- Klickbart → zoomar kartan till stegets position

### 6. "Visa i byggnad"-knapp + indoor-handoff
- Lägg till knapp i route summary: "Visa i byggnad"
- Klick → sparar rutt-data i `sessionStorage` (`pending_indoor_route`) → navigerar till `/viewer?building=GUID`
- I `NativeViewerShell` / `SplitPlanView`: läs `pending_indoor_route`, visa via `RouteDisplayOverlay`, byt till rätt våning

### 7. Indoor steg-generator — `generateSteps()` i `pathfinding.ts`
- Segmentera rutten vid riktningsbyten (>30° vinkeländring) och floor-transitions
- Generera instruktioner: "Gå rakt 12 m", "Sväng vänster", "Ta hissen till våning 3"
- Returnera `{ instruction, distance, type, floorGuid }[]`

### 8. Ny komponent: `RouteStepperPanel.tsx`
- Visar aktuellt steg med ikon
- Föregående/Nästa-knappar
- Highlightar aktivt segment i viewer (tjockare linje)
- Automatiskt våningsbyte vid floor-transitions

## Filer att skapa/ändra

| Fil | Åtgärd |
|---|---|
| `supabase/functions/google-directions/index.ts` | **Ny** — Google Routes API proxy |
| `supabase/config.toml` | Lägg till `[functions.google-directions]` |
| `src/components/map/NavigationMapPanel.tsx` | Transit-knapp, steps-lista, "Visa i byggnad" |
| `src/components/map/MapView.tsx` | Anropa google-directions vid transit, spara steps |
| `src/lib/pathfinding.ts` | `generateSteps()` |
| `src/components/viewer/RouteStepperPanel.tsx` | **Ny** — steg-för-steg panel |
| `src/components/viewer/NativeViewerShell.tsx` | Rendrera RouteStepperPanel, läs pending_indoor_route |
| `src/components/viewer/SplitPlanView.tsx` | Läs pending_indoor_route, visa overlay |

