
Målet är att fixa fem tydliga fel i samma leverans: tom egenskapsdialog, dubbla/insekventa högerklicksmenyer, trasig 2D-knapp, felaktig/seg Insights-infärgning och prestanda när rumslabels är på.

1) Egenskapsdialog: tom + saknar tydlig stängning
- Rotorsak:
  - Dialogen hämtar endast via `fm_guid` (textfält, skiftlägeskänsligt i praktiken i nuvarande flöde).
  - Många klickade BIM-objekt saknar lokal asset-rad, vilket ger “No data found”.
  - Stängning finns som vänsterpil men inte tydlig “X”, och headern upplevs lätt som dold.
- Plan:
  - Uppdatera `NativeViewerShell` så dialogen får både `entityId` och `fmGuid`.
  - Uppdatera `UniversalPropertiesDialog`:
    - Case-insensitiv guid-match (normaliserad jämförelse).
    - Fallback-visning av BIM-metadata från viewer när ingen lokal datarad hittas.
    - Lägg till tydlig stäng-knapp (X) uppe till höger, behåll vänsterpil.
    - Behåll sök/edit när lokal data finns; fallback blir read-only.

2) “Två olika högermenyer” i viewer
- Rotorsak:
  - `ViewerContextMenu` bygger två varianter: lång (entity hittad) och kort (ingen entity).
- Plan:
  - Standardisera till en och samma menystruktur:
    - Entity-kommandon visas alltid men är disabled när inget objekt hittas.
  - Förbättra pick-logik i `NativeViewerShell`:
    - Försök pick med robust fallback (inkl. selected object om pick missar).
  - Resultat: användaren upplever en enda konsekvent högerklicksmeny.

3) 2D-knappen fungerar inte stabilt
- Rotorsak:
  - 2D-flödet är eventdrivet via flera lager (`UnifiedViewer` + `ViewerToolbar`), och re-apply av 2D när läget redan är “2d” är för svagt.
  - Golvkontext kan saknas i exakt switch-ögonblick.
- Plan:
  - Inför en central mode-switch-funktion i `UnifiedViewer` för desktop:
    - Sätter mode + dispatchar nödvändiga mode-events konsekvent.
  - I `ViewerToolbar`:
    - Stöd “force reapply 2D” även om mode redan är 2D.
    - Om valt våningsplan saknas: hämta senaste golvval från floor-event-cache innan clipping.
    - Fallback: global 2D clipping med säker återställning om floor-bounds saknas.
  - Säkra att Native Xeokit alltid visar valt våningsplan i toppvy med clipping.

4) Insights: fel våningar färgas + staplar reagerar dåligt
- Rotorsak:
  - `energyByFloor` begränsas med `slice(0,6)` (tappar våningar).
  - Jämförelser görs ibland utan normalisering (`levelFmGuid === fmGuid`).
  - Name-fallback i viewer kan färga rum med samma namn på fel våningar.
- Plan:
  - `BuildingInsightsView`:
    - Ta bort 6-våningsbegränsning.
    - Normalisera guid-jämförelser för våning/rum konsekvent.
    - När användaren klickar en stapel: bygg färgkarta strikt från rummen på just den våningen.
  - `NativeXeokitViewer`:
    - Lägg till “strict guid mode” för Insights-färgning (ingen name-fallback för dessa klick).
    - Pre-indexera metaobjekt per guid för snabbare och säkrare träff.
  - Resultat: klick på t.ex. “Plan A-00” färgar endast rum som tillhör A-00.

5) 3D blir seg med rumslabels
- Rotorsak:
  - `useRoomLabels` gör tung occlusion-pick loopande över många labels.
- Plan:
  - Optimera `useRoomLabels`:
    - Adaptiv throttling (lägre uppdateringsfrekvens vid många labels).
    - Auto-stäng av occlusion över tröskel (eller när Insights-färgning är aktiv).
    - Begränsa label-uppdatering till synligt golv + viewport-culling tidigare i flödet.
  - Resultat: tydligt bättre interaktion i 3D när labels är aktiverade.

Tekniska filer som ändras
- `src/components/viewer/NativeViewerShell.tsx`
- `src/components/common/UniversalPropertiesDialog.tsx`
- `src/components/viewer/ViewerContextMenu.tsx`
- `src/pages/UnifiedViewer.tsx`
- `src/components/viewer/ViewerToolbar.tsx`
- `src/components/insights/BuildingInsightsView.tsx`
- `src/components/viewer/NativeXeokitViewer.tsx`
- `src/hooks/useRoomLabels.ts`

Verifiering (acceptanskriterier)
- Högerklick på objekt: samma menystruktur varje gång, entity-rader korrekt enabled.
- “Egenskaper”: visar data (lokal eller BIM-fallback), tydlig X för stängning syns.
- 2D-knapp: går alltid till native 2D med clipping av valt våningsplan.
- Insights:
  - Klick på stapel “Plan X” färgar enbart rum på Plan X.
  - Problemvåningar (t.ex. B-00) reagerar korrekt.
- 3D-prestanda: märkbar förbättring med rumslabels på.
- Sluttest: kör hela flödet end-to-end i viewer (3D → 2D → Insights-klick → tillbaka till 3D med labels).
