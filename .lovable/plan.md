

# Plan: Implementera 3D + 360° Synkronisering

## Sammanfattning

Synkroniseringen mellan 3D-visaren och 360°-vyn fungerar inte eftersom den faktiska kommunikationslogiken saknas. ViewerSyncContext är ett "skelett" utan "muskler" - vyerna är inte anslutna för att skicka eller ta emot kameraförändringar.

## Nuläge (vad som saknas)

| Komponent | Problem |
|-----------|---------|
| `AssetPlusViewer.tsx` | Lyssnar inte på kameraändringar, skickar inte `updateFrom3D()` |
| `Ivion360View.tsx` | Saknar `postMessage`-kommunikation med Ivion-iframe |
| `SplitViewer.tsx` | Har bara `useEffect` som loggar, ingen faktisk synk |

## Lösning (tre lager)

### Lager 1: 3D-visaren → ViewerSyncContext

| Åtgärd | Beskrivning |
|--------|-------------|
| Lyssna på kameraändringar | Anslut till xeokit `viewMatrix`-events |
| Skicka position | Anropa `updateFrom3D(position, heading, pitch)` |
| Ta emot synk | Reagera på `syncState` från Ivion och flyga till positionen |

```text
xeokit camera.on('viewMatrix') → extractCameraParams() → updateFrom3D()
```

### Lager 2: 360°-visaren ↔ Ivion iframe

NavVis Ivion stödjer ett Frontend API via `postMessage`:

| Riktning | Metod |
|----------|-------|
| **Ivion → App** | Lyssna på `message`-events med `navvis-event` |
| **App → Ivion** | Skicka `postMessage` med `navvis-command` |

Viktiga kommandon:
- `moveToGeoLocation(lat, lng, heading, pitch)` - Navigera till position
- `camera-changed` event - Ivion skickar när kameran ändras

### Lager 3: Koordinattransformation

3D-visaren använder **lokala BIM-koordinater** (meter), Ivion använder **geografiska koordinater** (lat/lng).

```text
Transformation:
lat = originLat + (localY / 111320)
lng = originLng + (localX / (111320 × cos(originLat)))
```

Byggnadsrotation måste också appliceras på heading.

## Databasändring

Lägg till `rotation`-kolumn i `building_settings` för att kunna konvertera heading mellan 3D och Ivion:

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| `rotation` | `DECIMAL` | Byggnadens rotation i grader relativt norr (0-360) |

## Filer att ändra

| Fil | Ändringar |
|-----|-----------|
| `src/components/viewer/AssetPlusViewer.tsx` | Lägg till sync-props, lyssna på kamera, reagera på syncState |
| `src/components/viewer/Ivion360View.tsx` | Lägg till postMessage-hantering, sync-props |
| `src/pages/SplitViewer.tsx` | Skicka sync-callbacks till båda viewers |
| `src/context/ViewerSyncContext.tsx` | Lägg till koordinattransformations-helpers |
| `src/hooks/useBuildingSettings.ts` | Lägg till `rotation` i interface |
| **Databas** | Migration för `rotation`-kolumn |

## Implementation steg för steg

### Steg 1: Uppdatera ViewerSyncContext

```text
- Lägg till helper-funktioner för koordinattransformation:
  - localToGeo(localCoords, buildingContext) → {lat, lng}
  - geoToLocal(lat, lng, buildingContext) → LocalCoords
  - transformHeading(heading, rotation, direction) → number
```

### Steg 2: Uppdatera AssetPlusViewer

```text
Props:
- onCameraChange?: (position, heading, pitch) => void
- syncPosition?: LocalCoords
- syncHeading?: number
- syncPitch?: number
- syncEnabled?: boolean

Implementation:
1. Lägg till kamera-listener vid initialisering:
   xeokitViewer.scene.camera.on('viewMatrix', () => {
     const eye = viewer.scene.camera.eye;
     const heading = calculateHeading(eye, look);
     onCameraChange?.({x: eye[0], y: eye[1], z: eye[2]}, heading, pitch);
   });

2. Lägg till useEffect för att ta emot sync:
   useEffect(() => {
     if (syncEnabled && syncPosition) {
       cameraFlight.flyTo({eye: [...], look: [...], duration: 0.5});
     }
   }, [syncPosition, syncEnabled]);
```

### Steg 3: Uppdatera Ivion360View

```text
Props:
- onCameraChange?: (position, heading, pitch) => void
- syncLat?: number
- syncLng?: number
- syncHeading?: number
- syncEnabled?: boolean

Implementation:
1. Lägg till iframeRef och postMessage-hantering:
   const iframeRef = useRef<HTMLIFrameElement>(null);

2. Lyssna på meddelanden från Ivion:
   useEffect(() => {
     const handler = (event) => {
       if (event.data.type === 'navvis-event' && event.data.event === 'camera-changed') {
         const { lat, lng, heading, pitch } = event.data.data;
         onCameraChange?.(...);
       }
     };
     window.addEventListener('message', handler);
     return () => window.removeEventListener('message', handler);
   }, []);

3. Skicka navigeringskommando när sync ändras:
   useEffect(() => {
     if (syncEnabled && syncLat && iframeRef.current) {
       iframeRef.current.contentWindow.postMessage({
         type: 'navvis-command',
         action: 'moveToGeoLocation',
         params: { lat: syncLat, lng: syncLng, heading: syncHeading }
       }, '*');
     }
   }, [syncLat, syncLng, syncEnabled]);
```

### Steg 4: Uppdatera SplitViewer

```text
- Hämta buildingContext med lat/lng/rotation från building_settings
- Anropa updateFrom3D när 3D-visaren rapporterar kameraändring
- Anropa updateFromIvion när Ivion rapporterar kameraändring
- Transformera koordinater mellan systemen
- Skicka syncPosition till 3D när source='ivion'
- Skicka syncLat/Lng till Ivion när source='3d'
```

## Sekvensdiagram

```text
┌─────────────┐         ┌───────────────────┐         ┌─────────────┐
│ AssetPlus   │         │ ViewerSyncContext │         │ Ivion360    │
│ (3D Viewer) │         │                   │         │ (iframe)    │
└──────┬──────┘         └─────────┬─────────┘         └──────┬──────┘
       │                          │                          │
       │ camera.on('viewMatrix')  │                          │
       │ ─────────────────────────>                          │
       │     updateFrom3D(pos)    │                          │
       │                          │                          │
       │                          │ syncState changed        │
       │                          │ (source='3d')            │
       │                          ├─────────────────────────>│
       │                          │    postMessage(...)      │
       │                          │                          │
       │                          │   camera-changed event   │
       │<─────────────────────────┼──────────────────────────│
       │   flyTo(syncPosition)    │    updateFromIvion(pos)  │
       │                          │                          │
```

## Begränsningar och fallbacks

| Scenario | Hantering |
|----------|-----------|
| Ivion stödjer inte postMessage | Visa "Manuell synk" - en knapp som kopierar kameraposition |
| Saknar lat/lng i building_settings | Visa varning, kräv konfiguration |
| Saknar rotation | Anta 0 (norr-orienterad byggnad) |
| Ivion-iframe blockerar kommunikation | Visa info om att synk kräver konfiguration |

## Tekniska detaljer

### Koordinattransformation (pseudokod)

```text
function localToGeo(local, origin, rotation):
  // Rotera lokala koordinater
  rotatedX = local.x * cos(rotation) - local.z * sin(rotation)
  rotatedZ = local.x * sin(rotation) + local.z * cos(rotation)
  
  // Konvertera till geo
  lat = origin.lat + (rotatedZ / 111320)
  lng = origin.lng + (rotatedX / (111320 * cos(origin.lat)))
  return {lat, lng}

function geoToLocal(geo, origin, rotation):
  // Konvertera från geo
  localZ = (geo.lat - origin.lat) * 111320
  localX = (geo.lng - origin.lng) * 111320 * cos(origin.lat)
  
  // Rotera tillbaka
  x = localX * cos(-rotation) - localZ * sin(-rotation)
  z = localX * sin(-rotation) + localZ * cos(-rotation)
  return {x, y: local.y, z}
```

### Heading-transformation

```text
ivionHeading = (bimHeading + buildingRotation) % 360
bimHeading = (ivionHeading - buildingRotation + 360) % 360
```

## Acceptanskriterier

1. När användaren klickar i 3D-vyn och synk är på: Ivion navigerar till motsvarande position
2. När användaren navigerar i Ivion och synk är på: 3D-kameran flyger till motsvarande position
3. Sync ON/OFF-knappen fungerar korrekt
4. Reset-knappen återställer båda vyerna till startposition
5. Koordinater transformeras korrekt mellan BIM och geo-system

