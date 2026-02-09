

# Fix 5 Issues: Alignment UX, Remove Unnecessary Split Controls, Opacity Slider, SDK Restarts, and Error Banner

## 1. Alignment -- Hur det fungerar och forbattring

### Sa har fungerar Alignment idag

Alignment-panelen (AlignmentPanel.tsx) justerar fyra parametrar som transformerar koordinater mellan Ivion 360-varlden och BIM 3D-modellens varld:

- **Offset X/Y/Z**: Flyttar hela 3D-modellen relativt 360-panoramat (i meter)
- **Rotation**: Roterar 3D-modellen runt Y-axeln (i grader)

Nar man drar en slider andras transform-vardena live. I VT-laget ser man direkt hur 3D-modellen "glider" over 360-bilden. Man justerar tills vaggar, dorrar och golv i 3D-modellen overlappar med vad man ser i panoramat. Sedan sparar man transformationen till databasen.

### Problemet

Det saknas en tydlig arbetsmetod. Slidrarna med +-100 meter ar svara att anvanda for precis justering. Det finns ingen referenspunktsfunktion -- man maste "oga" overlagringen och hoppas att man traeffar ratt.

### Forbattring: Visuell guide + finare kontroll

Istallet for att bygga en komplex punkt-matchning (som kraver att man kan peka pa exakt samma punkt i bade 3D och 360, vilket ar tekniskt mycket svart), forbattrar vi Alignment-panelen sa att den blir enklare att anvanda:

1. **Hjalptextblock**: Lagg till en kort instruktion langst upp i panelen som forklarar arbetsmetoden: "Navigera i 360 till en plats dar du kan se tydliga byggnadselement (dorr, vagg, pelare). Justera offsetvardena tills 3D-modellen overlappar med 360-bilden."

2. **Tva kontrollnivaar per slider**: 
   - En **grov-slider** (+-100m, steg 0.1m) for initial positionering
   - En **fin-slider** (+-2m, steg 0.01m) som dyker upp nar man klickar "Finjustera" -- for exakt justering

3. **Korsharsmarkorer (crosshair)**: Rita en tunn centrumkorsmarkering i mitten av vyn, sa att man har en visuell referenspunkt att rikta mot vid justering.

4. **Snabbknappar**: Lagg till + och - knappar bredvid varje slider for att nudga vardet med ett litet steg (0.05m for offset, 0.5 grader for rotation).

### Filer som andras

| Fil | Andring |
|---|---|
| `src/components/viewer/AlignmentPanel.tsx` | Lagg till hjalptextblock, finjusteringslage, nudge-knappar |
| `src/pages/UnifiedViewer.tsx` | Visa crosshair-overlay nar alignment-panelen ar oppen |

## 2. Ta bort onodiga Split-kontroller

I Split-laget finns tre knappar som inte langre behovs:

- **"Klicka for att avsynka / synka"** (Link2/Link2Off-knapp, rad 393-405)
- **"Synka manuellt fran URL"** (Upload-knapp, rad 407-414)
- **"Aterstall synk"** (RotateCcw-knapp, rad 416-423)

Dessutom ska **synk-statusindikatorn** (rad 382-391) och **den manuella synk-dialogen** (rad 561-582) tas bort.

**Opacity-slidern** ska BARA visas i VT-lage, inte i Split-lage (rad 436: andras fran `viewMode === 'vt' || viewMode === 'split'` till `viewMode === 'vt'`).

### Filer som andras

| Fil | Andring |
|---|---|
| `src/pages/UnifiedViewer.tsx` | Ta bort: sync status display, sync lock-knapp, manual sync URL-knapp, reset sync-knapp, manual sync-dialog. Begranssa opacity till VT. |

## 3. Ghost Opacity Slider fungerar bara vid uppstart

### Rotorsak

Opacity-effekten i UnifiedViewer (rad 233-249) koer `setObjectsOpacity()` nar `ghostOpacity` andras. Men problemet ar att **AssetPlusViewer ocksa applicerar opacity internt** (rad 1278-1293) nar modellen laddas fardigt. Denna interna applikation kors med `ghostOpacity`-proppen som skickas vid renderingstillfallet.

**Det riktiga problemet**: `setObjectsOpacity` i xeokit satter opacity pa **befintliga objekt**, men nar nya modeller laddas (eller objekt aterstalls av Asset+ viewer), skrivs opacity over. Effekten kors bara en gang nar `ghostOpacity` andras -- men den tanker inte pa att viewer-instansen kan vara mitt i en re-render som aterstaeller opacity.

**Losning**: Istallet for att lita pa en `useEffect` med en snapshot av xeokit-viewer, anvand en `requestAnimationFrame`-baserad applikation som koer kontinuerligt sa lange VT-laget ar aktivt. Detta garanterar att opacity alltid ar ratt, aven om viewer aterstaller objekt internt.

### Filer som andras

| Fil | Andring |
|---|---|
| `src/pages/UnifiedViewer.tsx` | Byt ut `useEffect`-baserad opacity (rad 233-249) mot en `requestAnimationFrame`-loop som koer sa lange `viewMode === 'vt'` |

## 4. SDK laddning orsakar oregelbundna omstarter

### Rotorsak

Konsolloggen visar: `"Ivion SDK initialization timed out after 45000ms"`. Tva parallella SDK-laddningar sloss:

1. **useIvionSdk** (UnifiedViewer rad 89): Laddas for VT/360-lagen. Skapar en `<ivion>` element i `sdkContainerRef`.
2. **Ivion360View** (rad 147-207): Har sin EGEN SDK-laddning med sin EGEN `<ivion>` element. Anvands i Split-laget.

Nar man startar i Split-lage:
- `sdkNeeded` ar `false` (rad 87: `viewMode === 'vt' || viewMode === '360'`), sa `useIvionSdk` ar inaktiv
- Ivion360View startar sin egen SDK-laddning
- Men nar Ivion360View anropar `loadIvionSdk()`, injicerar den `?site=` i URL:en
- SDK:n hittar `<ivion>`-elementet som Ivion360View skapade...
- ...men SDK:n forsoker rendera i ett element som kan vara for litet (inuti ResizablePanel)
- Om SDK:n timear ut, satts `sdkStatus = 'failed'` i Ivion360View, och iframe-fallback visas

**Problem med omstarter**: SDK:ns `getApi()` modifierar `window.location` via `replaceState`, vilket kan trigga React Router att reagera. Dessutom rensas `?site=` parametern efter SDK-init (rad 342-349), vilket ocksa andrar URL:en. Dessa URL-andringar kan orsaka att React-komponenter unmountar/remountar.

### Losning

1. **Ta bort `?site=`-manipulation fran URL:en helt** i `ivion-sdk.ts`. Istallet, skicka `site` direkt i SDK-konfigurationen:
   ```
   sdkConfig.site = siteId;
   ```
   Om SDK:n inte stodjer detta, anvand den befintliga fallback-mekanismen (auto-navigate to site via API efter init) utan att modifiera `window.location`.

2. **Forhindra att `useIvionSdk` och `Ivion360View` laddar SDK samtidigt**: I Split-lage, lat `useIvionSdk` vara inaktiv (redan sa). Men se till att Ivion360View inte startar SDK-laddning om en annan laddning redan pagaar (det befintliga `activeLoadPromise`-garden i `ivion-sdk.ts` ska hantera detta, men vi maste verifiera att det fungerar korrekt).

3. **Stabillisera ivion-sdk.ts**: Ta bort all `window.history.replaceState`-manipulation. Navigera till site via API istallet (rad 352-377 fungerar redan som fallback).

### Filer som andras

| Fil | Andring |
|---|---|
| `src/lib/ivion-sdk.ts` | Ta bort all `replaceState`-manipulation av `?site=`. Skicka siteId i SDK config istallet. |

## 5. "Kunde inte hamta bildpositioner for synk" banner

### Rotorsak

Bannern visas i `Ivion360View.tsx` rad 537-548 nar:
- `syncEnabled` ar `true`
- `hasImageLoadError` ar `true`
- `imageCache.length === 0`

I Split-lage skickas `syncEnabled={syncLocked}` (UnifiedViewer rad 535), och `syncLocked` ar `true` som standard. Hook:en `useIvionCameraSync` forsoker hamta bildpositioner fran `ivion-poi`-funktionen (action: `get-images-for-site`), och om det misslyckas visas bannern.

**Eftersom vi tar bort de manuella synk-kontrollerna i punkt 2**, ar fragan: behover vi fortfarande bildpositions-cachen i Split-lage?

Svaret ar **ja** om vi behaller automatisk synk. Men **nej** om vi tar bort all synkfunktionalitet fran Split-laget.

### Beslut

Eftersom alignment-panelen (punkt 1) hanterar den manuella kalibreringen, och VT-laget har sin egen one-directional sync, **tar vi bort syncEnabled fran Split-laget helt**. Detta eliminerar bannern och all sync-overhead i Split-laget.

### Filer som andras

| Fil | Andring |
|---|---|
| `src/pages/UnifiedViewer.tsx` | Skicka `syncEnabled={false}` till Ivion360View i Split-lage |

## Sammanfattning av alla filandringar

| Fil | Andringar |
|---|---|
| `src/components/viewer/AlignmentPanel.tsx` | Lagg till hjalptextblock, finjusteringslage med +- 2m sliders, nudge-knappar (+-0.05m/+-0.5 grader), crosshair-flagga |
| `src/pages/UnifiedViewer.tsx` | (1) Ta bort split sync-kontroller (link/unlink, manual URL, reset). (2) Begranssa opacity-slider till VT. (3) Skicka syncEnabled=false till Ivion360View i split. (4) Byt opacity useEffect till rAF-loop. (5) Visa crosshair nar alignment ar oppen i VT. (6) Ta bort manual sync dialog. |
| `src/lib/ivion-sdk.ts` | Ta bort all `window.history.replaceState` URL-manipulation. Skicka `site` i SDK-config direkt. Behall API-baserad site-navigering som fallback. |

## Tekniska detaljer

### Alignment Panel -- Ny layout

```text
+--[Move3D] Alignment ────────────── [Reset][Save]──+
|                                                     |
| Navigera till en tydlig plats i 360. Justera       |
| vardena tills 3D overlappar panoramabilden.          |
|                                                     |
| Offset X                      [-][slider][+] 0.00m |
| Offset Y                      [-][slider][+] 0.00m |
| Offset Z                      [-][slider][+] 0.00m |
| Rotation                      [-][slider][+] 0.0°  |
|                                                     |
| [Finjustera v]  <-- expanderbar sektion             |
|   Fine X        [-][slider][+]  +-2m, step 0.01m   |
|   Fine Y        [-][slider][+]  +-2m, step 0.01m   |
|   Fine Z        [-][slider][+]  +-2m, step 0.01m   |
|   Fine Rot      [-][slider][+]  +-10 deg, step 0.1 |
+-----------------------------------------------------+
```

### Opacity rAF-loop (ersatter useEffect)

```typescript
useEffect(() => {
  if (viewMode !== 'vt') return;
  let running = true;
  const loop = () => {
    if (!running) return;
    try {
      const xv = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer
        ?? (window as any).__assetPlusViewerInstance?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      if (xv?.scene) {
        const ids = xv.scene.objectIds;
        if (ids?.length) xv.scene.setObjectsOpacity(ids, ghostOpacity / 100);
      }
    } catch {}
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return () => { running = false; };
}, [viewMode, ghostOpacity]);
```

### ivion-sdk.ts URL-manipulation borttagning

Bort:
```typescript
// Remove all replaceState calls (lines 238-251, 292-298, 342-349)
```

Istallet:
```typescript
// In doLoadIvionSdk, just pass site to config:
if (siteId) {
  sdkConfig.siteId = siteId;  // Try as config property
}
// Keep the existing API-based fallback (lines 352-377) unchanged
```

## Riskbedomning

- **Alignment UX (ingen risk)**: Additivt -- nya kontroller, befintlig funktionalitet oforandrad
- **Borttagna split-kontroller (lag risk)**: Rensar UI. Sync-funktionaliteten behalls i VT-laget dar den behovs
- **Opacity rAF-loop (lag risk)**: Mer robust an useEffect. Loop koer bara i VT-lage, sa ingen overhead i andra lagen
- **SDK URL-manipulation (medel risk)**: Att ta bort `replaceState` ar den storsta risken. Om SDK:n KRAVER `?site=` i URL:en for att fungera, maste vi behalla det. Men API-baserad site-navigering (rad 352-377) fungerar redan som fallback, sa detta borde vara sakert
- **Borttagen syncEnabled i split (lag risk)**: Gor att Ivion360View inte forsoker hamta bildpositioner, vilket eliminerar felbannern

