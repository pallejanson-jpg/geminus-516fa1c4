
# Fix Split View: 3D-laddning och kamerasynkronisering

## Problem

Split View har tva kritiska buggar:
1. **3D-modellen laddar inte korrekt** -- AssetPlusViewer far ett fmGuid som ar ett byggnads-GUID, men modellerna kraschar eller visas inte i split-kontextet
2. **Kamerorna foljer inte varandra** -- nuvarande implementation forsaker anvanda postMessage-kommandon till Ivion-iframen, men Ivion stodjer INTE dessa kommandon i iframe-lage. Den enda kanalen for att styra Ivion programmatiskt ar genom NavVis Frontend API SDK (`@navvis/ivion`), som maste laddas dynamiskt fran Ivion-instansen

## Grundorsaker

### Problem 1: 3D-modellsladdning
- AssetPlusViewer tar emot `fmGuid` och saker efter motsvarande post i `allData` (AppContext)
- I split view-laget passas byggnadens fmGuid, men `xktCacheService.ensureBuildingModels()` kan timeoutas eller misslyckas tyst
- Det finns ingen felatergivning nar modeller inte hittas eller nar cache-synk misslyckas
- Viewern visar bara en tom container istallet for att rapportera problemet

### Problem 2: Kamerasynk (allvarligaste problemet)
Den nuvarande synk-strategin ar felaktig:

**3D till 360 (fungerar inte):**
- Koden skickar `postMessage({ type: 'navvis-command', action: 'moveToLocation', ... })` till Ivion-iframen
- Ivion reagerar INTE pa dessa meddelanden -- det ar inte ett stott API
- Fallback: andrar `iframe.src` med ny `&image=XXX` -- detta tvingar en FULLSTANDIG omladdning av Ivion (tar 5-10 sekunder), satt aven detta ar oanvandbart for realtidssynk

**360 till 3D (fungerar inte):**
- Koden lysnar efter `postMessage` fran Ivion men Ivion sander INGA sadana meddelanden spontant
- Prenumerationskommandona (`subscribe`) ar ogiltiga i Ivions iframe-API
- Resultatet: `postMessageActive` forblir `false` och ingen automatisk synk sker

### Korrekt losning: NavVis Frontend API (SDK)
Enligt NavVis-dokumentationen ar det ratta sattet att integrera Ivion:

```text
import { getApi, ApiInterface } from "@navvis/ivion";

// Ladda SDK dynamiskt fran Ivion-instansen:
getApi("https://swg.iv.navvis.com/").then((iv: ApiInterface) => {
  // Lasa position (MainViewInterface):
  const image = iv.getMainView().getImage();  // Aktiv bild med position
  const viewDir = iv.getMainView().currViewingDir;  // lon/lat i radianer

  // Navigera till position:
  iv.moveToGeoLocation(position, isLocal, viewDir, fixedLat, fov, normal, forceLoc);
  iv.moveToImageId(imageId, viewDir, fov);
});
```

Dock kraver `@navvis/ivion` NPM-paketet att Ivion renderas som en `<div>` (inte iframe). For iframe-embeddings maste vi anvanda en alternativ strategi.

## Losning: Ivion URL-polling + nearest-image navigation

Eftersom vi anvander iframe-embedding och inte kan ladda `@navvis/ivion` SDK:t direkt, implementerar vi en robust synk-mekanism baserad pa:

### 3D till 360: Nearest Image Navigation via URL-uppdatering
1. Nar 3D-kameran andras, hitta narmaste Ivion-bild till 3D-positionen (redan implementerat i `findNearestImage`)
2. Istallet for att andra `iframe.src` (som tvingar omladdning), anvand URL hash-fragment eller `window.history.replaceState` - men detta fungerar inte cross-origin
3. **NY STRATEGI**: Byt fran iframe till `@navvis/ivion` SDK-rendering direkt i en `<div>`. SDK:t laddas dynamiskt fran Ivion-instansens URL

### 360 till 3D: Periodisk URL-polling
1. **NY STRATEGI**: Lasa Ivion iframe-URL:en periodiskt (via `getShareUrl()` om SDK ar tillgangligt, annars URL-polling)
2. Extrahera `image=XXX` och `vlon`/`vlat` fran URL:en
3. Slaa upp bild-positionen i image cache
4. Uppdatera 3D-viewern

## Implementationsplan

### Steg 1: Byt Ivion fran iframe till SDK-rendering

**Fil: `src/components/viewer/Ivion360View.tsx`**
- Byt fran `<iframe>` till en `<div id="ivion-container">`
- Ladda NavVis SDK dynamiskt fran Ivion-instansens URL med ett script-element: `<script src="https://swg.iv.navvis.com/ivion.js">`
- Anvand `getApi(ivionUrl)` for att fa `ApiInterface`
- Exponera API-instansen via en ref for synk-hooken

### Steg 2: Implementera riktig bi-direktionell synk med SDK

**Fil: `src/hooks/useIvionCameraSync.ts`**
Skriv om hooken helt for att anvanda SDK:t:

**360 till 3D (Ivion leder):**
1. Anvand `iv.getMainView().getImage()` for att lasa aktiv bild (position i lokala koordinater)
2. Anvand `iv.getMainView().currViewingDir` for att lasa kamerariktning (lon/lat radianer)
3. Polla dessa varden med `requestAnimationFrame` eller `setInterval(200ms)`
4. Nar position andras: uppdatera `ViewerSyncContext` -> 3D-viewern flyer till positionen

**3D till 360 (3D-viewern leder):**
1. Nar 3D-kameran andras, hamta eye-position och heading
2. Hitta narmaste Ivion-bild i image cache (redan implementerat)
3. Anvand `iv.moveToImageId(nearestImageId, viewDir, fov)` for att navigera Ivion
4. Anvand `iv.getMainView().updateOrientation({ lon, lat })` for att satta kamerariktning

### Steg 3: Fixa initial synk-position

**Fil: `src/pages/SplitViewer.tsx`**
1. Nar split view oppnas, hamta startbild fran `building_settings.ivion_start_vlon/vlat`
2. Ladda narmaste Ivion-bild till 3D-viewerns initiala kameraposition
3. Navigera bade 3D och 360 till samma startpunkt

### Steg 4: Fixa 3D-modell-laddning i split view

**Fil: `src/pages/SplitViewer.tsx` och `src/components/viewer/AssetPlusViewer.tsx`**
1. Lagg till tydlig felhantering nar XKT-modeller inte hittas
2. Visa laddningsstatus tydligt (spinner + meddelande)
3. Kontrollera att `allData` faktiskt innehaller byggnaden innan rendering

### Steg 5: Koordinattransformation

**Fil: `src/lib/coordinate-transform.ts`**
- Ivion SDK ger positioner i lokala koordinater (meter, samma som BIM)
- Om koordinatsystemen inte matchar, anvand `moveToGeoLocation` med `isLocal=true` for att undvika WGS84-konvertering
- Heading-konvertering: Ivion anvander lon/lat (radianer), xeokit anvander heading (grader) -- konverteringsfunktionerna finns redan

## Tekniska detaljer

### NavVis SDK dynamisk laddning
```text
// Ladda SDK script fran Ivion-instansen
const script = document.createElement('script');
script.src = `${ivionBaseUrl}/ivion.js`;
script.onload = () => {
  const getApi = (window as any).NavVis?.getApi || (window as any).getApi;
  getApi(ivionBaseUrl).then((iv) => {
    ivApiRef.current = iv;
    // SDK redo -- starta synk
  });
};
document.head.appendChild(script);
```

### Synk-loop (huvudlogik)
```text
// Polling varje 200ms
setInterval(() => {
  if (!syncLocked || !ivApiRef.current) return;

  const mainView = ivApiRef.current.getMainView();
  const image = mainView.getImage();
  const viewDir = mainView.currViewingDir; // { lon, lat } radianer

  if (image && image.id !== lastImageIdRef.current) {
    lastImageIdRef.current = image.id;
    const pos = image.location; // { x, y, z } meter
    const heading = viewDir.lon * (180 / Math.PI);
    const pitch = viewDir.lat * (180 / Math.PI);
    updateFromIvion({ x: pos.x, y: pos.y, z: pos.z }, heading, pitch);
  }
}, 200);
```

### 3D till 360 navigering
```text
// Nar 3D-kameran andras och syncLocked=true:
const nearestImage = findNearestImage(eye3D);
if (nearestImage && nearestImage.id !== lastSentImageId) {
  lastSentImageId = nearestImage.id;
  const viewDir = { lon: headingRad, lat: pitchRad };
  ivApiRef.current.moveToImageId(nearestImage.id, viewDir, undefined);
}
```

### Fallback for iframe-lage
Om SDK-laddning misslyckas (t.ex. CORS-problem), behall nuvarande iframe-baserade losning men med forbattrad URL-polling:
- Anvand `setInterval` for att lasa iframe-URL:en (om same-origin)
- Fallback till manuell synk-knapp som finns idag

## Andringar per fil

| Fil | Andringar |
|-----|-----------|
| `src/components/viewer/Ivion360View.tsx` | Byt fran iframe till div + SDK-rendering. Exponera API-ref. Behall iframe som fallback. |
| `src/hooks/useIvionCameraSync.ts` | Skriv om for SDK-baserad synk (polling position + moveToImageId). Behall image-cache for nearest-image-sokning. |
| `src/pages/SplitViewer.tsx` | Fixa initial synk-position. Forbattra felhantering for modell-laddning. |
| `src/context/ViewerSyncContext.tsx` | Inga stora andringar -- bara eventuellt lagre debounce (50ms istf 100ms) |
| `src/hooks/useViewerCameraSync.ts` | Smarre fix: sakerstalla att isSyncing-flaggan nollstalls korrekt |
| `src/lib/coordinate-transform.ts` | Eventuella justeringar for Ivion lon/lat konvertering |

## Implementationsordning

1. Forst: Undersok om `@navvis/ivion` SDK:t kan laddas dynamiskt i vart anvandningsfall (CORS, licens)
2. Implementera SDK-baserad rendering i Ivion360View (byt fran iframe till div)
3. Implementera bi-direktionell synk med SDK (polling + moveToImageId)
4. Fixa initial startposition
5. Fixa 3D-modell-laddningsproblem
6. Testa hela flodet end-to-end

## Risker och alternativ

- **Risk**: Ivion SDK kraver licens (`isLicensed()` returnerar false) -- DA: fallback till forbattrad iframe-polling
- **Risk**: CORS blockerar SDK-laddning -- DA: proxyera via edge function eller anvand iframe med periodisk URL-lasning
- **Risk**: Ivion koordinater matchar inte BIM-koordinater -- DA: behover offset-kalibrering per byggnad (laggs i building_settings)
