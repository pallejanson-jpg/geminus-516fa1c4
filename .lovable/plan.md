
## Mål (det du beskriver)
1) **2D-läget (rent 2D)** ska visa en “slice” av valt våningsplan (standard **1.2 m**) så att **väggar/dörrar/fönster/möbler är klickbara**, och inte bara “tomt”.
2) **Split 2D/3D på mobil**: överdelen (minimap/plan) ska använda **xeokits StoreyViewsPlugin** och **inte bli tom**.
3) **Verktyg**: **Mätning ska fungera i split** (3D-panelen), men **snitt/section** ska (enligt ditt val “Hybrid”) endast fungera i **full 3D** (inte i split), för maximal stabilitet/prestanda.
4) **Layout**: Fullskärm/edge-to-edge ska bara gälla **mobil**, desktop ska ha normal header+content utan att klippa.

---

## 1) Snabb rotorsaks-analys (varför 2D och split-minimap blir tomt idag)
Utifrån koden + runtime-screenshot:
- 3D-panelen laddar modellen korrekt, men **SplitPlanView renderar ingen bild** (och visar i praktiken en mörk/tom yta).
- SplitPlanView bygger på att xeokit-meta innehåller **IfcBuildingStorey** i `viewer.metaScene.metaObjects`. Om:
  - meta saknas/inte är klar när plugin initieras, eller
  - StoreyViewsPlugin inte lyckas registrera storeys, eller
  - `createStoreyMap()` returnerar en bild som blir “osynlig” (transparent/kontrast), eller
  - bilden inte laddas (img onError) utan att vi visar det,
  då blir resultatet tomt utan tydlig feedback.

**Viktig observation:** SplitPlanView saknar “hårda” diagnostik-UI (status + senaste fel + storey count + imageData length) och saknar `img.onError` → vi ser “tomt” men får ingen vägledning.

---

## 2) Plan: Åtgärda split-minimap (StoreyViewsPlugin) så den aldrig är “tyst tom”
### 2.1 Lägg till tydlig diagnostik i SplitPlanView (för att låsa felet direkt)
I `src/components/viewer/SplitPlanView.tsx`:
- Visa en liten debug-rad i hörnet (endast i dev) med:
  - `viewerReady` (finns scene/metaScene)
  - `metaStoreyCount` (antal IfcBuildingStorey i meta)
  - `pluginStoreyCount`
  - `lastTriedStoreyId`
  - `imageDataLength`
  - `lastError`
- Lägg till `onError` på `<img>` som sätter `error` om data-url inte renderar.
- Logga ett kompakt “one-liner” i console när:
  - plugin initieras
  - map genereras (storeyId, width/height, imageDataLength)
  - map misslyckas (exception message)

Detta gör att vi kan gå från “tomt” → exakt orsak på första testet.

### 2.2 Gör createStoreyMap visuellt robust (kontrast/transparent)
För att undvika “transparent PNG på mörk bakgrund ser tomt ut”:
- Sätt SplitPlanView-container till **vit/ljus bakgrund** oavsett tema när vi visar plan (t.ex. `background: #fff`), eller lägg en vit “canvas-matta” bakom `<img>`.
- Om vi ändå vill följa tema: lägg en toggle senare. Först: robust.

### 2.3 Initiera StoreyViewsPlugin från samma SDK-källa som viewern (minska versions/globala skillnader)
Just nu laddar:
- NativeXeokitViewer: xeokit SDK via fetch+Blob-import
- SplitPlanView: import via `Function('return import("/lib/xeokit/xeokit-sdk.es.js")')()`

Plan:
- Exponera SDK-objektet från NativeXeokitViewer globalt (t.ex. `window.__xeokitSdk`), och låt SplitPlanView använda den om den finns.
- Fall back till egen import endast om global saknas.

Det minskar risken att StoreyViewsPlugin inte matchar viewer-version.

### 2.4 Fallback om storeys saknas: “plan snapshot”
Om modellen saknar IfcBuildingStorey-meta (eller plugin inte hittar storeys):
- Fallback: generera en 2D-bild genom att:
  - temporärt sätta en top-down ortho-kamera,
  - rendera en frame,
  - använda `viewer.scene.canvas.canvas.toDataURL()`
  - återställa kamera.
Det är inte lika “riktig storey map”, men gör att användaren aldrig ser “tomt” och vi kan fortfarande klicka för navigation (i fallback begränsat).

---

## 3) Plan: Fixa rent 2D-läge (klipp + klickbarhet på objekt)
I `src/components/viewer/ViewerToolbar.tsx` + `src/hooks/useSectionPlaneClipping.ts`:

### 3.1 Klipp-strategi (1.2 m standard)
Behåll standard: `topClipY = floorMinY + 1.2`.
Men gör bounds robust:
- Om `calculateFloorBounds(floorId)` ger null eller uppenbart fel:
  - försök få storey AABB via StoreyViewsPlugin (om tillgänglig), annars
  - fallback: använd `scene.aabb` + heuristik (t.ex. närmaste Y-kluster).

### 3.2 Klickbarhet (pickable) i 2D
I 2D-mode logiken sätter vi idag vissa typer pickable=false (slabs).
Plan:
- Säkerställ att **väggar/dörrar/fönster/möbler** alltid förblir `pickable=true` i 2D (om de är synliga).
- Låt **IfcSpace** vara “svagt” och pickable (för rums-klick), men håll golvplattor/coverings icke-klickbara.

### 3.3 Undvik att 2D-mode råkar göra scenen “tom”
Säkra ordningen:
1) Välj floorId (eller default lägsta).
2) Applicera klipp-plan.
3) Först efter det: gör typ-styling (opacity/edges).
4) Avsluta med att “reveal canvas”.

Och lägg en säkerhetsåterställning:
- Om antal synliga objekt efter 2D-enter blir “nära 0”, auto-rollback:
  - ta bort klipp
  - logga diagnos
  - visa toast i dev.

---

## 4) Plan: Verktyg (mätning + snitt) ska faktiskt göra något
Just nu togglar `ViewerToolbar` bara state + event, men **installerar inga verktygs-plugins** och kopplar inte pointer-events för att skapa mätningar/snitt.

### 4.1 Mätverktyg (ska fungera i split)
- Installera xeokit **DistanceMeasurementsPlugin** när viewern är redo (NativeXeokitViewer eller NativeViewerShell).
- När `VIEWER_TOOL_CHANGED_EVENT` = `measure`:
  - aktivera pluginens input-läge (eller egna canvas handlers som:
    - pickar world points (pickSurface true när möjligt),
    - skapar measurement mellan 2 punkter,
    - visar label/line.
- Lägg “clear measurements” knapp i toolbar när measure aktiv.

### 4.2 Snittverktyg (endast full 3D enligt “Hybrid”)
- I split-läge (viewMode === split2d3d på mobil):
  - disable/hidden “Section” i toolbar med tooltip “Tillgängligt i full 3D”.
  - lägg knapp “Öppna full 3D” (byter mode till 3d) bredvid eller i 3-punktsmenyn.
- I full 3D:
  - installera **SectionPlanesPlugin** och koppla interaktion (dra ett plan, rotera/offset, clear).

---

## 5) Plan: Layout (mobil edge-to-edge, desktop normal)
### 5.1 Mobil
Behåll `MobileUnifiedViewer` som `fixed inset-0` + `100dvh/100vw` (det uppfyller “hela skärmen” på mobil).

### 5.2 Desktop (ändra så header inte klipps/överlappas)
I desktop-rendern i `src/pages/UnifiedViewer.tsx`:
- Byt content wrapper från `absolute inset-0` till en **`flex-1 relative`** under header.
- Viewer-lager ska fylla bara content-ytan (inte över header).
Detta eliminerar “klipper lite upp och ner” på desktop och gör desktop-läget stabilt.

---

## 6) Testplan (jag kör själv med browser tools + loggar)
1) Öppna mobil: `/viewer?building=<en byggnad med floors>&mode=split2d3d`
2) Verifiera att SplitPlanView visar:
   - storey count > 0
   - imageDataLength > 0
   - img renderar (ingen onError)
3) Klick i 2D-plan → kameraflytt i 3D-panelen.
4) Växla till rent `mode=2d`:
   - klipp 1.2 m
   - klick på vägg/dörr/fönster ger pick-result (minst highlight/selected).
5) Measure i split:
   - skapa mätning mellan två punkter.
6) Section i split:
   - ska vara disabled + länk till full 3D.
7) Section i full 3D:
   - skapa snitt, clear.

---

## Filer som kommer beröras (implementation)
- `src/components/viewer/SplitPlanView.tsx` (diagnostik, robust init, bakgrund, img onError, SDK-källa, fallback)
- `src/components/viewer/NativeXeokitViewer.tsx` (exponera SDK globalt; ev installera plugins)
- `src/components/viewer/ViewerToolbar.tsx` (verklig tool-aktivering, split-regler för section, 2D robusthet)
- `src/hooks/useSectionPlaneClipping.ts` (robust bounds, skydd mot “tomt”)
- `src/pages/UnifiedViewer.tsx` (desktop layout: flex-1 content istället för absolute inset-0)

---

## Förväntat resultat (acceptanskriterier)
- Split 2D/3D på mobil: överdelen visar planbild (inte tom) inom 10 sek efter load.
- Rent 2D-läge: synlig “slice” av valt plan, och objekt är klickbara.
- Mätverktyg fungerar i split. Snittverktyg är avstängt i split men fungerar i full 3D.
- Desktop: tillbaka till normal layout (header + viewer under), utan klipp uppe/nere.
