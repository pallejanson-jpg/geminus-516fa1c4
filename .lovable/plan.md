

# Seamless Outdoor-to-Indoor Navigation

## Overview
Extend the existing MapView with Mapbox Directions API for outdoor routing to a building entrance, then transition to an indoor map view with room polygons and indoor routing when the user zooms in past a threshold (zoom ~17).

## Architecture

```text
┌──────────────────────────────────────────┐
│  MapView (extended)                       │
│                                           │
│  Zoom < 17: Outdoor mode                  │
│  ┌─────────────────────────────────┐      │
│  │ Mapbox Directions route line    │      │
│  │ (walking/driving to building)   │      │
│  └─────────────────────────────────┘      │
│                                           │
│  Zoom ≥ 17: Indoor mode                  │
│  ┌─────────────────────────────────┐      │
│  │ GeoJSON room polygons layer     │      │
│  │ + indoor nav graph route line   │      │
│  │ + floor switcher control        │      │
│  └─────────────────────────────────┘      │
│                                           │
│  NavigationMapPanel (floating panel)      │
│  - From: user location / search           │
│  - To: building + room selector           │
│  - Combined distance & ETA                │
└──────────────────────────────────────────┘
```

## Implementation

### 1. Mapbox Directions integration (edge function)
**New file:** `supabase/functions/mapbox-directions/index.ts`
- Proxies requests to Mapbox Directions API using the existing `MAPBOX_ACCESS_TOKEN` secret
- Input: origin coords, destination coords, profile (walking/driving)
- Returns GeoJSON LineString route + duration + distance

### 2. Indoor room polygons as GeoJSON
**New file:** `src/hooks/useIndoorGeoJSON.ts`
- Fetches room (Space) assets for a building from `assets` table
- For buildings with georeferencing (lat/lng + rotation in building_settings), converts BIM bounding boxes to geographic GeoJSON polygons using `localToGeo` from coordinate-transform.ts
- Returns a GeoJSON FeatureCollection of room polygons per floor, with properties: room name, fm_guid, floor

### 3. Navigation map panel
**New file:** `src/components/map/NavigationMapPanel.tsx`
- Floating panel on the map with:
  - "From" field: current GPS location or typed address (Mapbox Geocoding)
  - "To" field: building selector → room selector (from assets)
  - Profile toggle: walking / driving
  - "Navigate" button
- Displays combined route summary: outdoor distance + indoor distance, total ETA
- Dispatches route data to map layers

### 4. Extended MapView with indoor layers
**Edit:** `src/components/map/MapView.tsx`
- Add state for navigation mode (outdoor route, indoor route, selected floor)
- At zoom ≥ 17 near a building with coords:
  - Render GeoJSON room polygon `Source` + `Layer` (fill + outline)
  - Render indoor navigation graph route as a `Source` + `Layer` (dashed line)
  - Show a compact floor switcher control
- At any zoom with active outdoor route:
  - Render Mapbox Directions route as a GeoJSON `Source` + `Layer` (blue line)
- Connect outdoor route endpoint (building entrance) to indoor route start node

### 5. Indoor floor switcher on map
**New file:** `src/components/map/IndoorFloorSwitcher.tsx`
- Small vertical pill showing floor buttons (1, 2, 3...)
- Changes which floor's room polygons and route segments are visible
- Appears only when zoomed into indoor mode

### 6. Route connection logic
**Edit:** `src/lib/pathfinding.ts`
- Add `findNearestEntranceNode(graph)` — finds the node closest to the building entrance (lowest floor, nearest to building origin)
- Used to connect the outdoor route's last coordinate to the indoor route's first node

## Data Flow

1. User selects destination building + room in NavigationMapPanel
2. Panel fetches outdoor route via `mapbox-directions` edge function (user GPS → building lat/lng)
3. Panel loads indoor nav graph for building, runs Dijkstra from entrance node to target room
4. Both routes rendered as Mapbox GeoJSON layers
5. As user zooms in past threshold, outdoor route fades, room polygons + indoor route appear
6. Floor switcher filters visible indoor data by floor

## Files to Create
1. `supabase/functions/mapbox-directions/index.ts` — Directions API proxy
2. `src/hooks/useIndoorGeoJSON.ts` — Room polygon GeoJSON generator
3. `src/components/map/NavigationMapPanel.tsx` — Navigation UI panel
4. `src/components/map/IndoorFloorSwitcher.tsx` — Floor control on map

## Files to Edit
1. `src/components/map/MapView.tsx` — Add indoor layers, route layers, navigation state
2. `src/lib/pathfinding.ts` — Add entrance node finder
3. `supabase/config.toml` — Register new edge function (verify_jwt = false)

