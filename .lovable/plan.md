
## Problem

1. **Kamera synkar inte konsekvent i 2D→3D klick**: `handleClick` i `SplitPlanView.tsx` (rad 520-527) använder `flyTo()` med `duration: 0.8`. Efter första klicket uppdateras 3D-kameran, men efterföljande klick verkar inte trigga konsekvent. Anledningen är troligen att `flyTo()` inte avbryts vid snabba klick, eller att kamera-lyssnaren bara uppdaterar kamerapos-overlayen men inte synkroniserar korrekt.

2. **Room labels saknas i 2D-planen (split)**: `SplitPlanView` genererar en PNG-bild via `createStoreyMap()`. Denna är en statisk rasterbild — inga DOM-overlay-labels läggs på den. `useRoomLabels` fungerar i 3D-canvas men kan inte återanvändas direkt på 2D-bilden.

3. **Kameravinkel i 3D**: Efter klick i 2D sätts `eye` till samma höjd som nuvarande kamera (rad 521-522: `viewer.camera.eye[1]`). Detta ger inkonsekvent vy beroende på var kameran var innan. Bättre: fast höjd + lutning ner mot golvet.

## Plan

### 1. Fix kamera-sync: Instant fly + alltid trigga
- I `handleClick` (SplitPlanView.tsx): ändra `duration: 0.8` → `duration: 0` för instant kamerabyte
- Anropa `viewer.cameraFlight.cancel?.()` före varje `flyTo()` för att avbryta pågående flight
- Detta säkerställer att varje klick omedelbart flyttar kameran

### 2. Fast kameravinkel: 8m höjd, 45° pitch
- Istället för `viewer.camera.eye[1]` (nuvarande höjd), använd en **fast höjd på 8 meter** över klickpunkten
- Beräkna `look` så att kameran tittar ~45° nedåt mot klickpunkten
- Detta ger en konsekvent och användbar 3D-vy efter varje 2D-klick

**Formel:**
```
look = [worldX, worldY, worldZ]  // klickpunkten på planet
eye = [worldX + offset, look[1] + 8, worldZ + offset]  // 8m upp, lite bakåt
```

### 3. Room labels i 2D-split: ny overlay
Skapa en ny hook eller funktion `useRoomLabelsOverlay` i `SplitPlanView` som:
- Hämtar rum-data från viewer's `metaScene` (samma som `useRoomLabels` gör)
- För varje rum: beräknar 2D-position på storey-map-bilden via `storeyMapToWorldPos` inverse (eller via AABB-mappning)
- Renderar DOM-labels ovanpå bilden med svart text på transparent bakgrund

**Stil (enligt tidigare godkänd):**
- `color: #000`
- `background: transparent`
- `text-shadow: 0 0 3px white, 0 0 3px white`
- `font-size: 10px`

**Positionsberäkning:**
```
normX = (roomWorldX - aabb[0]) / (aabb[3] - aabb[0])
normZ = (roomWorldZ - aabb[2]) / (aabb[5] - aabb[2])
imgX = (1 - normX) * 100%  // % av bilden
imgY = (1 - normZ) * 100%
```

Labels placeras inuti samma transform-container som bilden så pan/zoom fungerar.

## Filer att ändra
- `src/components/viewer/SplitPlanView.tsx` — kamerafix + room labels overlay
