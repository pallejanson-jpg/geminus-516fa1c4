
Mål: stabilisera 2D/3D split, få tillbaka korrekt 2D→3D navigation, visa mini-våningsväljare, förbättra menyresponsivitet/close-beteende, göra avdelaren tunn+draggable och ta bort 20s låsning i ren 2D.

1) Snabb logganalys + sannolik kraschorsak
- Jag ser inga fångade console/network-fel i snapshot, vilket tyder på logisk loop/prestandalåsning snarare än ett tydligt exception.
- Kritisk kodorsak i `SplitPlanView`: `generateMap()` dispatchar `FLOOR_SELECTION_CHANGED_EVENT`, samtidigt lyssnar samma komponent på samma event och triggar ny `generateMap()` igen. Det kan ge kontinuerlig regenerering (hög CPU/låsning/kraschkänsla).

2) Stabilisering av SplitPlanView (huvudfix)
Fil: `src/components/viewer/SplitPlanView.tsx`
- Bryt event-loop:
  - Lägg `source` i event-detail (t.ex. `source: 'split-plan'`) och ignorera egna events i `floorHandler`.
  - Dispatcha floor-sync endast när våning faktiskt ändrats (last-dispatched guard).
- Fix 2D→3D-kamera (behåll riktning men korrekt position):
  - Fortsätt bevara heading, men clampa avstånd/y-offset (annars kan eye hamna långt utanför byggnaden).
  - Sätt `look` till klickpunkt, `eye` bakom look med begränsad distans.
  - Fallback om `storeyMapToWorldPos` misslyckas: använd aktivt storey-AABB (inte globalt scene-AABB).
- Fix kameramarkör i 2D:
  - Beräkna markörposition från `camera.look` (inte `camera.eye`) så markören visar faktisk målpunkt i rummet.
  - Använd `plugin.worldPosToStoreyMap()` i stället för manuell AABB-normalisering.
  - Clampa till bildens bounds så markör aldrig “försvinner”.
- Mini-våningsväljare:
  - Visa även när `useFloorData` är tom genom fallback till `plugin.storeys`.
  - Säkerställ att `selectedFloorId` alltid matchar options (ingen “tom value”-situation).
- Dalux-likare 2D-grafik:
  - Fintuning av text/linjer i snapshot-läget (mörkare linjer, mindre labels med vit halo).
  - Aktivt rum: lägg grön semitransparent highlight-overlay för valt/pickat rum.

3) Robust våningsdata så dropdown alltid dyker upp
Fil: `src/hooks/useFloorData.ts`
- Lägg global viewer-fallback (`window.__nativeXeokitViewer`) i accessor.
- Byt “hård timeout efter 20 polls” till event-driven refresh på `VIEWER_MODELS_LOADED` + fortsatt lätt polling tills viewer finns.
- Detta löser fall där floors aldrig hinner laddas i split.

4) Menyer i split: bättre responsivitet + stäng med X och utanför
Filer:
- `src/components/viewer/VisualizationToolbar.tsx`
- `src/components/viewer/ViewerFilterPanel.tsx`
- `src/components/viewer/SidePopPanel.tsx`
- `src/components/viewer/FloatingIssueListPanel.tsx`
- `src/components/viewer/NativeViewerShell.tsx`
- `src/pages/UnifiedViewer.tsx`
Plan:
- Inför “embedded split mode” för paneler (absolute inom 3D-panelen) istället för global `fixed` viewport-position.
- Lägg semitransparent backdrop bakom paneler och stäng på backdrop-click.
- Behåll X-knappstängning.
- Resultat: hela panelen inkl. kryss blir synlig i split och går alltid att stänga.

5) Avdelare mellan 2D/3D: tunnare och dragbar
Fil: `src/pages/UnifiedViewer.tsx`
- Desktop split2d3d: gör ratio dragbar (inte statisk 40/60).
- Mobil: minska visuell tjocklek (t.ex. 8–10px) men behåll större touch-hitbox.
- Lägg pointer+touch-drag så det fungerar både mus och touch.

6) Ren 2D mode låser ~20s: prestandafix
Fil: `src/components/viewer/ViewerToolbar.tsx`
- Gör mode-switch idempotent (ignorera upprepade “gå till 2D” när redan i 2D).
- Lägg transition-lock så tung 2D-setup inte kör parallellt flera gånger.
- Cachea typ-grupperade entity-listor vid modell-laddning och återanvänd vid 2D-styling (undvik full scan varje gång).
- Detta reducerar frysetider kraftigt och tar bort multipla tunga pass.

7) Verifiering (efter implementation)
- Split 2D/3D:
  - 2D-klick ska flytta 3D konsekvent varje gång till rätt rum/position.
  - Kameramarkör ska alltid synas och följa.
  - Mini-våningsväljare ska synas och byta plan.
- Menyer:
  - Kryss synligt.
  - Klick utanför stänger panel.
  - Side-panels/issue-list inte klippta i split.
- Divider:
  - Tunn, dragbar, ratio ändras live.
- Ren 2D:
  - Växling ska inte låsa systemet i långa sekvenser.
