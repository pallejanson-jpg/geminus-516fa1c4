

## Plan: Utöka navigeringen med Google Routes API för kollektivtrafik

### Bakgrund

Idag har ni:
- **Mapbox GL JS** för kartrendering (behålls)
- **Mapbox Directions API** (edge function `mapbox-directions`) för outdoor walking/driving
- **Dijkstra-baserad indoor pathfinding** via `navigation_graphs`-tabellen
- **NavigationMapPanel** med walking/driving-val
- **MAPBOX_ACCESS_TOKEN** redan konfigurerad

Mapbox saknar dock **kollektivtrafik (transit)** — bussar, tåg, tunnelbana. Google Routes API har det.

### Vad som behövs

**1. Google Routes API-nyckel**
- Skapa ett projekt i [Google Cloud Console](https://console.cloud.google.com)
- Aktivera **Routes API** (inte den äldre Directions API)
- Skapa en API-nyckel med begränsning till Routes API
- Nyckeln sparas som secret `GOOGLE_ROUTES_API_KEY`

**2. Ny edge function: `google-routes`**
- Anropas när profil = `transit`
- Anropar `https://routes.googleapis.com/directions/v2:computeRoutes` med `travelMode: TRANSIT`
- Returnerar polyline, duration, distance samt **transit-steg** (busslinje, hållplats, avgångstid)

**3. Uppdatera NavigationMapPanel**
- Lägg till en tredje profil-knapp: 🚌 Transit (utöver Walk/Drive)
- Visa transit-specifik info i route summary: linjenummer, hållplatsnamn, byten

**4. Uppdatera MapView.handleNavigate**
- Om profil = `transit` → anropa `google-routes` istället för `mapbox-directions`
- Konvertera Google-polyline (encoded) till GeoJSON för visning på Mapbox-kartan
- Behåll indoor-handoff-logiken oförändrad

### Teknisk arkitektur

```text
┌─────────────────────┐
│  NavigationMapPanel  │  walk / drive / transit
└─────────┬───────────┘
          │
    ┌─────▼──────┐        ┌──────────────────┐
    │  MapView   │───────►│ mapbox-directions │  (walk/drive)
    │            │───────►│ google-routes     │  (transit)
    └─────┬──────┘        └──────────────────┘
          │
    ┌─────▼──────────────┐
    │ Indoor pathfinding │  (oförändrad)
    └────────────────────┘
```

### Filer som ändras/skapas

| Fil | Ändring |
|-----|---------|
| `supabase/functions/google-routes/index.ts` | **Ny** — proxy till Google Routes API |
| `supabase/config.toml` | Lägg till `[functions.google-routes]` med `verify_jwt = false` |
| `src/components/map/NavigationMapPanel.tsx` | Lägg till transit-profil + transit-steg i summary |
| `src/components/map/MapView.tsx` | Villkora anrop baserat på profil, hantera Google-polyline |
| Secret: `GOOGLE_ROUTES_API_KEY` | **Ny** — lagras via secrets-verktyget |

### Steg-för-steg

1. **Du skapar Google API-nyckeln** — gå till Google Cloud Console → APIs & Services → Credentials → Create API Key → begränsa till "Routes API"
2. Jag sparar nyckeln som secret `GOOGLE_ROUTES_API_KEY`
3. Jag skapar edge function `google-routes` som proxar till Google Routes API
4. Jag uppdaterar NavigationMapPanel med transit-knapp och transit-specifik route summary
5. Jag uppdaterar MapView för att routa transit-anrop till rätt edge function

