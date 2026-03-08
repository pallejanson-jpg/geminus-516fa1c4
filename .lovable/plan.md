
# Plan: 2D/3D Split-vy förbättringar

## Identifierade problem

1. **2D storey-kartan genereras långsamt** — `SplitPlanView` väntar på `VIEWER_MODELS_LOADED` (rad 153), sen kör `createStoreyMap()` via `requestIdleCallback` med max 3s delay. Plugin-init pollas dessutom upp till 20 gånger (200ms vardera) = max 4+ sekunder innan någonting ritas.

2. **2D-kartan inte centrerad** — Pan/zoom-containern (rad 768–773) har `transformOrigin: '0 0'` och initialt scale 75% + offset 0/0. Bilden flexas till center men transform nollställer inte korrekt → förskjutning åt vänster.

3. **3D-kameran flyger bara vid första klick** — `viewer.cameraFlight.flyTo()` med `duration: 0` triggas, men om `plugin.storeyMapToWorldPos()` returnerar `null` (saknar storey i plugin) så avbryts funktionen. Vid byte av våning (rad 393–400) omskapas kartan men 3D-viewer vet inte om det nya våningsplanet → nästa klick får felaktig Y-höjd.

4. **3D saknar koppling till valt våningsplan** — `SplitPlanView` dispatchar aldrig `FLOOR_SELECTION_CHANGED_EVENT` så 3D-viewern (toolbar + floor-switcher) synkar inte vilken våning som visas; detta bryter `flyTo`-logiken.

5. **Mini-dropdown för våningsval saknas** — Du vill ha ett litet våningsval-element i 2D-delen som visar aktuellt plan och låter dig välja annat plan.

6. **3D-kamera vid klick: behåll riktning** — Istället för fast 45° vy ska kameran flytta till klickad punkt men behålla nuvarande kamera-heading (look-direction).

## Plan

### 1. Snabbare 2D-laddning (`SplitPlanView.tsx`)
- Ändra SDK-laddning till att köras i `useEffect` vid mount — inte bara vid `VIEWER_MODELS_LOADED`
- Minska retry-intervall till 100ms och max-attempts till 10 (= max 1s väntan)
- Kör `doGenerate()` utan `requestIdleCallback` för att undvika 3s delay på första kartan

### 2. Centrera 2D-bilden (`SplitPlanView.tsx`)
- Ändra `transformOrigin` till `'center center'`
- Beräkna initial offset baserat på container-center, inte 0,0
- Eller: sätt panZoom initial state via `useEffect` som centerar bilden efter `imgRef` har fått sin storlek

### 3. Synka valt våningsplan → 3D (`SplitPlanView.tsx`)
- När `generateMap()` körs med ett `preferredStoreyId`, dispatcha `FLOOR_SELECTION_CHANGED_EVENT` med `floorId` och `visibleMetaFloorIds` så att 3D-viewern (toolbar, floor-switcher, clipping) synkar
- Detta fixar att efterföljande klick vet vilken Y-höjd de ska använda

### 4. 3D-kamera: behåll heading/riktning (`SplitPlanView.tsx`)
- I `handleClick()`: Istället för fasta `PITCH_OFFSET` och `HEIGHT_OFFSET`, beräkna:
  1. Nuvarande kamerans heading-vektor: `heading = normalize(look - eye)` (projicerat XZ)
  2. Behåll avståndet från eye till look
  3. Nytt `look` = klickad punkt (`worldX, floorY, worldZ`)
  4. Nytt `eye` = `look - heading * distance` (så kameran pekar samma håll mot nya punkten)
- Duration: `0` (instant flyTo)

### 5. Mini-dropdown för våningsval (`SplitPlanView.tsx` eller ny komponent)
- Lägg till en ny komponent `FloorDropdown` (eller inline `Select`) i 2D-panelen (övre vänstra hörnet)
- Hämta `floors` från `useFloorData` (redan importerad)
- Visa aktuellt våningsnamn; onChange: uppdatera `selectedFloorRef` och trigga `generateMap()` + dispatcha `FLOOR_SELECTION_CHANGED_EVENT`
- Stil: liten, kompakt (h-6 text-[10px]), med bakgrund för kontrast

### 6. Desktop vs mobil layout
- Desktop: dropdown ligger i 2D-panelens övre vänstra hörn
- Mobil: samma placering, men möjligen ännu kompaktare (h-5)

## Filer att ändra
- `src/components/viewer/SplitPlanView.tsx` — laddnings-optimering, centrering, floor-sync, kamera-behåll-riktning, mini-dropdown

## Tekniska detaljer

**Centrera 2D-kartan (alternativ 1):**
```tsx
// I panZoom initial state:
const [panZoom, setPanZoom] = useState<PanZoom>({ offsetX: 0, offsetY: 0, scale: 0.75 });
// → ändra transformOrigin till 'center center' och adjustera offset efter bildens laddning
useEffect(() => {
  if (!imgRef.current || !containerRef.current) return;
  const container = containerRef.current.getBoundingClientRect();
  const img = imgRef.current.getBoundingClientRect();
  // Center the scaled image
  const ox = (container.width - img.width * 0.75) / 2;
  const oy = (container.height - img.height * 0.75) / 2;
  setPanZoom({ offsetX: ox, offsetY: oy, scale: 0.75 });
}, [storeyMap]);
```

**Behåll heading-beräkning:**
```tsx
const eye = viewer.camera.eye;
const look = viewer.camera.look;
// XZ heading vector
const headX = look[0] - eye[0];
const headZ = look[2] - eye[2];
const headLen = Math.sqrt(headX * headX + headZ * headZ);
const headUnit = headLen > 0.01 ? [headX / headLen, headZ / headLen] : [1, 0];
// Distance from eye to look
const dist = Math.sqrt((look[0]-eye[0])**2 + (look[1]-eye[1])**2 + (look[2]-eye[2])**2);
// New look = clicked world pos
const newLook = [worldX, floorY, worldZ];
// New eye = look - heading * horizontal dist, keep same Y offset
const horizDist = Math.sqrt((eye[0]-look[0])**2 + (eye[2]-look[2])**2);
const yOffset = eye[1] - look[1];
const newEye = [
  newLook[0] - headUnit[0] * horizDist,
  newLook[1] + yOffset,
  newLook[2] - headUnit[1] * horizDist
];
viewer.cameraFlight.flyTo({ eye: newEye, look: newLook, duration: 0 });
```

**Mini-dropdown (koncept):**
```tsx
<Select value={selectedFloorRef.current.floorId || ''} onValueChange={(floorId) => { ... }}>
  <SelectTrigger className="absolute top-2 left-2 z-20 h-6 w-auto min-w-[80px] text-[10px] bg-card/95 backdrop-blur-sm border shadow-sm">
    <SelectValue placeholder="Välj plan" />
  </SelectTrigger>
  <SelectContent>
    {floors.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
  </SelectContent>
</Select>
```
