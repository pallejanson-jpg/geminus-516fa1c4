

# Plan: Split-View Integration - 3D + 360° Side-by-Side Navigation

## Sammanfattning

En kraftfull integration där du kan navigera i både 3D-visaren och 360°-visaren samtidigt med synkroniserad position. När du flyttar dig i ena vyn, följer den andra automatiskt med (om du vill).

## Vision

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│  3D + 360° Synkroniserad Vy                                              [×]    │
├─────────────────────────────────────┬────────────────────────────────────────────┤
│                                     │                                            │
│         ┌─────────────────┐         │              ┌─────────────────┐           │
│         │                 │         │              │                 │           │
│         │   3D VIEWER     │         │              │   360° VIEWER   │           │
│         │   (Asset+)      │         │              │   (IVION)       │           │
│         │                 │         │              │                 │           │
│         │    🏢           │  ═══════│══════════    │    📷           │           │
│         │   ┌───┐         │  SYNC   │   LOCK      │                 │           │
│         │   │ ○ │ <──────────────────────────────>│    ○ <────      │           │
│         │   └───┘         │         │              │                 │           │
│         └─────────────────┘         │              └─────────────────┘           │
│                                     │                                            │
│    ┌─────────────────────────────┐  │    ┌──────────────────────────────────┐    │
│    │  [🔗 Sync Lock ON ]  │  │    │  [🏠 Floor: Plan 3]  [📌 POI]    │    │
│    └─────────────────────────────┘  │    └──────────────────────────────────┘    │
├─────────────────────────────────────┴────────────────────────────────────────────┤
│ [◄ Tillbaka]     [🔄 Återställ]     [🔒 Sync: ON]     [📏 50/50]                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## Navigeringsflöden

### Flöde 1: 3D → 360° Synkronisering

```text
┌─────────────┐    ┌────────────────┐    ┌─────────────────┐    ┌──────────────┐
│ Användare   │───▶│ 3D Viewer      │───▶│ Camera Event    │───▶│ Calculate    │
│ klickar i   │    │ xeokit scene   │    │ eye/look/up     │    │ geo-coords   │
│ 3D-modell   │    │ navigates      │    │ extracted       │    │ from local   │
└─────────────┘    └────────────────┘    └─────────────────┘    └──────────────┘
                                                                       │
                           ┌───────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                          AppContext: Sync Event Bus                              │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │  viewerSyncState: {                                                        │ │
│  │    coordinates: { x, y, z },                                               │ │
│  │    heading: 45°,                                                           │ │
│  │    source: '3d',                                                           │ │
│  │    timestamp: 1707123456789                                                │ │
│  │  }                                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Ivion360View                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │  1. Receive sync event (source !== 'ivion')                                │ │
│  │  2. Find nearest panorama to coordinates                                   │ │
│  │  3. Calculate heading/pitch for camera                                     │ │
│  │  4. PostMessage to iframe: { action: 'moveToLocation', x, y, heading }     │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Flöde 2: 360° → 3D Synkronisering

```text
┌─────────────┐    ┌────────────────┐    ┌─────────────────┐    ┌──────────────┐
│ Användare   │───▶│ IVION iframe   │───▶│ PostMessage     │───▶│ Parse coords │
│ navigerar   │    │ camera moves   │    │ event received  │    │ & heading    │
│ i 360°      │    │                │    │ in React        │    │              │
└─────────────┘    └────────────────┘    └─────────────────┘    └──────────────┘
                                                                       │
                           ┌───────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                          AppContext: Sync Event Bus                              │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │  viewerSyncState: {                                                        │ │
│  │    coordinates: { x, y, z },                                               │ │
│  │    heading: 120°,                                                          │ │
│  │    source: 'ivion',                                                        │ │
│  │    timestamp: 1707123456999                                                │ │
│  │  }                                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  AssetPlusViewer                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │  1. Receive sync event (source !== '3d')                                   │ │
│  │  2. Calculate xeokit eye/look from coordinates + heading                   │ │
│  │  3. viewer.cameraFlight.flyTo({ eye, look, up, duration: 0.5 })            │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## Ändringar

### 1. Ny Split-View Komponent

Skapa `SplitViewerPage.tsx` - en ny sida för synkroniserad visning:

| Element | Beskrivning |
|---------|-------------|
| Resizable layout | 50/50 delad vy med draggbar separator |
| Left panel | AssetPlusViewer (3D) |
| Right panel | Ivion360View (360°) |
| Header | Byggnadsinformation + Sync toggle |
| Footer | Snabbknappar för synk, reset, våningsval |

### 2. Synkroniseringsmotor (ViewerSyncContext)

Ny React Context för att hantera synkronisering:

```text
ViewerSyncContext
├── syncLocked: boolean          ── Låst = vyerna följer varandra
├── currentPosition: Coords      ── Delade koordinater
├── currentHeading: number       ── Kamerariktning i grader
├── lastUpdatedBy: '3d' | 'ivion' ── Vem uppdaterade senast
├── updateFrom3D(coords, heading) ── Anropas av AssetPlusViewer
└── updateFromIvion(coords, heading) ── Anropas av Ivion360View
```

### 3. Utöka AssetPlusViewer

Lägg till kamera-lyssnare för att sända position:

| Funktion | Beskrivning |
|----------|-------------|
| `onCameraChanged` callback | Anropas vid kameraförändringar (debounced 100ms) |
| `flyToSyncedPosition` | Flyger till position från Ivion |
| `syncEnabled` prop | Aktiverar synkroniseringslogik |

### 4. Utöka Ivion360View

Lägg till PostMessage-kommunikation:

| Funktion | Beskrivning |
|----------|-------------|
| `window.postMessage` | Sänder navigeringskommandon till iframe |
| `message` event listener | Tar emot kameraändringar från IVION |
| `syncEnabled` prop | Aktiverar synkroniseringslogik |

### 5. Navigation & Quick Actions

Lägg till genvägar för att öppna Split View:

| Plats | Åtgärd |
|-------|--------|
| Portfolio byggnadskort | "3D + 360°" knapp |
| Navigator kontextmeny | "Öppna i Split View" |
| 3D Viewer toolbar | "Öppna 360°" knapp (öppnar Split View) |
| 360° Viewer toolbar | "Öppna 3D" knapp (öppnar Split View) |

## Filer att skapa/ändra

| Fil | Åtgärd | Beskrivning |
|-----|--------|-------------|
| `src/context/ViewerSyncContext.tsx` | **Skapa** | Synkroniseringsmotor |
| `src/pages/SplitViewer.tsx` | **Skapa** | Split View sida |
| `src/components/viewer/AssetPlusViewer.tsx` | Ändra | Lägg till sync callbacks |
| `src/components/viewer/Ivion360View.tsx` | Ändra | Lägg till PostMessage-logik |
| `src/context/AppContext.tsx` | Ändra | Lägg till `openSplitView()` action |
| `src/components/layout/MainContent.tsx` | Ändra | Lägg till split_view case |
| `src/components/portfolio/FacilityCard.tsx` | Ändra | Lägg till "3D + 360°" knapp |

## Tekniska detaljer

### PostMessage-protokoll för IVION

NavVis IVION stödjer Frontend API via PostMessage. Kommandoformat:

```text
// Sända till IVION iframe
{
  type: 'navvis-command',
  action: 'moveToGeoLocation',
  params: {
    lat: 59.3293,
    lng: 18.0686,
    heading: 45,     // 0-360 grader
    pitch: 0         // -90 till 90
  }
}

// Ta emot från IVION iframe
{
  type: 'navvis-event',
  event: 'camera-changed',
  data: {
    location: { lat: 59.3293, lng: 18.0686, alt: 1.6 },
    heading: 120,
    pitch: -5,
    panoramaId: 'pano_12345'
  }
}
```

### Koordinatkonvertering

IVION använder geo-koordinater (lat/lng) medan xeokit använder lokala koordinater (x/y/z). Konvertering krävs:

```text
1. Byggnadens referenspunkt lagras i building_settings:
   - origin_lat: 59.3293
   - origin_lng: 18.0686
   - rotation: 15°  (byggnadens rotation relativt nord)

2. Vid sync 3D → IVION:
   - Transformera lokala coords till geo-coords
   - Beräkna heading baserat på kamerariktning + rotation

3. Vid sync IVION → 3D:
   - Transformera geo-coords till lokala coords
   - Beräkna eye/look från heading/pitch
```

### Debouncing & Performance

```text
- Camera events debounced till 100ms för att undvika storm
- Flyg-animationer i mottagande vy är 0.3-0.5 sekunder
- "source" fält förhindrar oändliga loopar
- Sync pausas automatiskt under användarinteraktion
```

## Användarupplevelse

### Scenario 1: Verifikation av inventerade tillgångar

1. Användare öppnar Split View för en byggnad
2. I 3D-vyn: Klickar på en brandsläckare-annotation
3. 360°-vyn: Navigerar automatiskt till närmaste panorama med samma riktning
4. Användare kan visuellt verifiera att 3D-positionen matchar verkligheten
5. Om fel: Klicka "Korrigera position" → uppdatera koordinater

### Scenario 2: AI-assisterad inspektion

1. AI Skanning identifierar tillgångar i 360°-bilder
2. Split View öppnas: 360° visar detekterad tillgång, 3D visar samma position
3. Användare validerar och godkänner/korrigerar
4. Position sparas med hög precision

### Scenario 3: Fri utforskning

1. Användare låser upp synk (Sync Lock = OFF)
2. Navigerar fritt i 360° för att hitta något
3. Klickar "Synka till 3D" för att flytta 3D-kameran till samma plats
4. Eller vice versa: hittar i 3D, klickar "Synka till 360°"

## Framtida möjligheter

| Funktion | Beskrivning |
|----------|-------------|
| **Object Highlighting** | Markera samma objekt i båda vyerna |
| **Measurement Sync** | Mätverktyg som fungerar i båda vyerna |
| **Timeline Sync** | Visa historiska 360°-bilder synkat med BIM-versioner |
| **AR Preview** | Förhandsvisa var nytt objekt ska placeras i båda vyerna |

