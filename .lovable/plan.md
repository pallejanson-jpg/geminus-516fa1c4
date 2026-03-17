
Målet nu är att fixa tre konkreta problem samtidigt, utan att byta bort nuvarande 2D/3D-arkitektur:

1. 2D-planen visar fel objekt och blir därför otydlig
2. kameraposition/kameraföljning i split-läge mappar fel
3. “Select Objects” är i praktiken alltid aktivt som standard

Vad jag har verifierat i koden:
- `SplitPlanView.tsx` bygger sina typ-listor globalt för hela modellen och stylar/hide:ar objekt utan att först begränsa till valt storey. Det förklarar exakt varför du ser `IfcRoof` / `IfcSlab` från våning 10/11 när Etasje 06 är vald.
- `SplitPlanView.tsx` använder inverterad koordinat för kameraoverlayn (`1.0 - normX`, `1.0 - normZ`), vilket mycket sannolikt är orsaken till att kameradotten och klicknavigeringen inte stämmer med planbilden.
- `UnifiedViewer.tsx` lyssnar på `SPLIT_PLAN_NAVIGATE` och flyttar 3D-kameran genom att återanvända nuvarande eye-look-offset. Det bevarar inte en tydlig “gå hit på planet”-logik och kan ge fel position i split-läge.
- `NativeViewerShell.tsx` har en click-handler som väljer objekt så länge verktyget inte är `measure` eller `slicer`. Det betyder att select i praktiken är på som default, precis som du beskriver.
- Ren 2D-styling i `ViewerToolbar.tsx` gör för många objekt synliga och pickable, inklusive objekt som borde bort i en planvy.

Plan för implementation:

1. Begränsa 2D-planen till valt våningsplan på riktigt
- I `SplitPlanView.tsx` bygger jag en tydlig mängd av entity IDs som faktiskt tillhör aktuell storey via metaobjektets descendants.
- All styling, visibility och pickability i planrenderingen scope:as till just den mängden.
- Objekt utanför valt storey döljs helt under map-capture.
- `IfcRoof`, `IfcSlab`, `IfcCovering` från andra våningar kommer därmed inte längre kunna läcka in i planbilden.

2. Inför strikt “plan view profile” för bättre läsbarhet
- I `SplitPlanView.tsx` ändrar jag från nuvarande typgruppering till en hård allowlist per plan:
  - Visa: väggar, pelare, relevanta dörrar/fönster, eventuellt spaces svagt
  - Dölj: roof, slab, covering, furniture, railing, stair/stairflight, equipment och övrigt brus
- Pickability följer samma princip: sådant som inte ska användas i 2D ska inte vara pickable.
- Resultatet blir en mycket renare plan, mer i linje med högkvalitativ BIM-2D.

3. Fixa kameradottens placering och 2D→3D mapping
- I `SplitPlanView.tsx` gör jag kameradotten och room-label-koordinaterna konsekventa med samma koordinatsystem som själva storey mapen.
- Jag tar bort den nuvarande “blind inversion” där det behövs och kalibrerar overlayn mot `storeyMapToWorldPos()` i stället för att ha separata antaganden för X/Z.
- Samma koordinatlogik används för:
  - kameradott
  - room labels
  - klicknavigering
  så att allt ligger i samma referensram.

4. Fixa split-lägets 3D-kameraföljning
- I `UnifiedViewer.tsx` ändrar jag `SPLIT_PLAN_NAVIGATE`-hanteringen så att 3D-kameran inte bara “flyttar offset”.
- I stället använder jag en tydlig first-person/plan-navigationslogik:
  - klickpunkt blir korrekt målpunkt på vald våning
  - heading bevaras
  - höjd sätts kontrollerat
  - look riktas konsekvent framåt från den nya positionen
- Det ska få 3D att hamna där användaren faktiskt klickar i 2D, inte bredvid eller på fel nivå.

5. Stäng av default-select globalt
- I `NativeViewerShell.tsx` ändrar jag canvas-click-selektionen så att den bara körs när aktivt verktyg verkligen är `select`.
- Default blir alltså “ingen selection tool aktiv”.
- Jag säkrar även att mode-byten inte implicit återaktiverar selection.
- Om något ska väljas i 2D-planen ska det ske explicit via planens egen logik eller via att användaren aktivt väljer select-verktyget.

6. Strama upp ren 2D-läget
- I `ViewerToolbar.tsx` uppdaterar jag 2D-mode-stylingen så att den följer samma strikta planprofil:
  - färre objekt synliga
  - färre objekt pickable
  - roof/slab/covering/furniture som stör döljs
- Detta gör att både ren 2D och split 2D/3D följer samma kvalitetsnivå i stället för två olika logiker.

Berörda filer:
- `src/components/viewer/SplitPlanView.tsx`
- `src/pages/UnifiedViewer.tsx`
- `src/components/viewer/NativeViewerShell.tsx`
- `src/components/viewer/ViewerToolbar.tsx`

Förväntat resultat efter fix:
- Etasje 06 visar bara objekt som hör till Etasje 06 i 2D-planen
- roof/slab från andra våningar försvinner ur planbilden
- kameradotten blir synlig och ligger rätt
- klick i 2D flyttar 3D-kameran till rätt plats
- “Select Objects” är inte aktivt som standard i något viewer-läge
- ren 2D blir avsevärt renare och mindre blockerad av pickable stör-objekt
