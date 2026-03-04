

# Plan: Cesium Globe — buggfixar + BIM-modell på kartan

## Problem

1. **"Visa detaljer" fungerar inte** — `handleNavigateToFacility` sätter `setActiveApp('portfolio')` men PortfolioView ser inte `selectedFacility` som signal att öppna landningssidan direkt.
2. **"Öppna 3D-viewer" fungerar inte** — `handleOpenViewer` navigerar till `/split-viewer` (som kanske inte finns eller inte hanterar kontexten rätt). Ska använda `setViewer3dFmGuid` istället, som automatiskt byter till `native_viewer`.
3. **Ny funktion: "Visa BIM-modell"** — Ladda XKT-modellens A-fil, konvertera till glTF, och placera den som en Cesium Entity med `ModelGraphics` på byggnadens geografiska position med korrekt rotation.

## Lösning

### 1. Fixa "Visa detaljer" (CesiumGlobeView.tsx)
```typescript
const handleNavigateToFacility = useCallback((fmGuid: string) => {
  setSelectedBuilding(null);
  setSelectedFmGuid(null);
  setZoomedFmGuid(null);
  const node = navigatorTreeData.find(n => n.fmGuid.toLowerCase() === fmGuid.toLowerCase());
  if (node) {
    setSelectedFacility(node);
  }
  setActiveApp('portfolio');
}, [navigatorTreeData, setSelectedFacility, setActiveApp]);
```
Problemet är att PortfolioView inte reagerar på `selectedFacility` direkt vid mount. Behöver trigga `navigateToFacility(node)` i PortfolioView — eller enklare: använda samma `setViewer3dFmGuid`-liknande mekanism. Den enklaste fixen: skicka ett event eller direkt sätta porföljens detaljvy-state.

**Egentlig fix**: `PortfolioView` har redan logik att visa `FacilityLandingPage` om `selectedFacility` matchar en facility. Koden ska fungera — problemet kan vara att `selectedFacility` sätts men `setActiveApp` inte korrekt triggar omrendering. Kontrollera att `setActiveApp('portfolio')` verkligen byter vy.

### 2. Fixa "Öppna 3D-viewer" (CesiumGlobeView.tsx)
Byt `navigate('/split-viewer')` till `setViewer3dFmGuid(fmGuid)` — detta sätter automatiskt `activeApp = 'native_viewer'` via AppContext-wrappern.

Kräver att vi importerar `setViewer3dFmGuid` från AppContext (redan tillgänglig).

### 3. Ny funktion: Visa BIM-modell i Cesium

**Strategi**: XKT-format kan inte visas i Cesium. Cesium stödjer glTF/glb-modeller via `Entity.model` (ModelGraphics). Vi behöver:

1. **Edge function `xkt-to-gltf`**: Konvertera XKT → glTF med xeokit-convert (som har `writeXKTModelToGLTF` eller liknande). Alternativt: ladda IFC-källfilen och konvertera till glb server-side.

   **Enklare approach**: Kontrollera om vi redan har glb/gltf-versioner av modellen i storage (från ACC-pipelinen). Om `acc-svf-to-gltf` redan producerar glb, kan vi återanvända det.

   **Praktisk approach**: Skapa en edge function som tar `buildingFmGuid`, hittar A-modellens XKT i storage, och konverterar det till en enkel glb med `@xeokit/xeokit-convert`. Alternativt: ladda IFC-originalfilen om den finns i `ifc-uploads` bucket.

   **Enklaste approach (fas 1)**: Använd `xeokit-convert`s `writeXKTModelToGLTF` i en edge function. Men xeokit-convert kanske inte exporterar till glTF — den importerar till XKT. 

   **Realistisk approach**: Skapa en ny edge function `bim-to-gltf` som:
   - Tar `buildingFmGuid` som input
   - Hittar IFC-fil i `ifc-uploads` bucket ELLER XKT i `xkt-models` bucket
   - Konverterar till glb med `web-ifc` (läser geometri, skriver glb)
   - Cachar resultatet i en `gltf-models` bucket
   - Returnerar signed URL

2. **CesiumGlobeView**: Tredje knapp "Visa BIM" som:
   - Anropar edge function för att få glb URL
   - Skapar en Cesium Entity med `ModelGraphics` på byggnadens lat/lng med `rotation` från `building_settings`
   - Visar laddningsindikator under konvertering

### Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/components/globe/CesiumGlobeView.tsx` | Fix handleNavigateToFacility, handleOpenViewer, lägg till handleShowBim + BIM-modell-rendering |
| `supabase/functions/bim-to-gltf/index.ts` | Ny edge function: konverterar IFC/XKT → glb, cachar i storage |

### Teknisk detalj: BIM-modell i Cesium

```typescript
// Placera glb-modell på rätt position och rotation
const entity = viewer.entities.add({
  position: Cesium.Cartesian3.fromDegrees(lng, lat, 0),
  orientation: Cesium.Transforms.headingPitchRollQuaternion(
    Cesium.Cartesian3.fromDegrees(lng, lat, 0),
    new Cesium.HeadingPitchRoll(
      Cesium.Math.toRadians(rotation || 0), 0, 0
    )
  ),
  model: {
    uri: glbSignedUrl,
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    minimumPixelSize: 64,
    maximumScale: 1,
  },
});
```

Edge function konverterar IFC → glb med web-ifc och en enkel glTF-writer. Resultat cachas i `gltf-models` storage bucket.

