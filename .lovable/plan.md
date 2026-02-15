
## Fix: 4 UI-problem i 3D-viewern

### 1. Tydligare vita textfarger i 3D-menyer

Flera menyer i 3D-viewern (dropdown-menyer, overflow-meny, hogerpanelen) anvander `text-foreground` och `text-muted-foreground` som kan bli otydliga mot mork bakgrund. Losningen ar att lagga till explicita ljusare textfarger i de relevanta komponenterna.

**Filer att andra:**
- `src/components/viewer/VisualizationLegendBar.tsx` -- andra `text-foreground/80` till `text-white` for legend-etiketter
- `src/components/viewer/ViewerToolbar.tsx` -- sakerstall att dropdown-menytexter ar tydliga med `text-foreground` (dessa ar redan pa `bg-card` sa de bor vara okej, men vi kontrollerar)
- `src/components/viewer/ViewerRightPanel.tsx` -- sakerstall att alla texter i panelen har tillracklig kontrast, speciellt `text-foreground/70`-referenserna

### 2. Legend-stapeln visas bara vid aktiv rumsvisualisering

`VisualizationLegendOverlay` lyssnar redan pa `VISUALIZATION_STATE_CHANGED` och doljer sig nar `visualizationType === 'none'`. Men den initialiserar fran `localStorage` och kan visa en stale legend vid start. Dessutom ska den uppdateras dynamiskt nar anvandaren byter typ (tex temperatur till CO2).

**Fix:**
- `src/components/viewer/VisualizationLegendOverlay.tsx` -- initialisera alltid med `'none'` istallet for att lasa fran localStorage. Legend-stapeln ska bara visas nar en aktiv visualisering har aktiverats under sessionen via eventet. Den uppdateras redan korrekt nar typen andras (eventet skickar ny `visualizationType`).

### 3. Nedre verktygsfalt doljs bakom browserns navigationsmeny pa mobil

`ViewerToolbar` positionerar sig med `bottom: calc(max(env(safe-area-inset-bottom), 12px) + 16px)`. Pa manga mobila webblasare racker detta inte -- browserns egna knappar (home indicator + navigeringsfalt) kan overlappa.

**Fix:**
- `src/components/viewer/ViewerToolbar.tsx` -- oka offset till `+ 28px` istallet for `+ 16px` for att ge mer utrymme under toolbaren pa mobil.

### 4. Stangknapp och pinnaknapp overlappar pa mobil i hogerpanelen

`SheetContent` i `sheet.tsx` renderar en absolut-positionerad X-knapp pa `right-4 top-4`. Hogerpanelens `SheetTitle` placerar Pin-knappen i samma omrade. Pa mobil overlappar dessa.

**Fix:**
- `src/components/viewer/ViewerRightPanel.tsx` -- pa mobil, dolj den inbyggda Sheet-stangknappen (genom att lagga till en CSS-klass som doljer den) och integrera bade stang- och pin-knapparna i SheetTitle-raden med korrekt avstand. Alternativt flytta pin-knappen till vanster sida av headern pa mobil.

### Tekniska detaljer

**`src/components/viewer/VisualizationLegendBar.tsx`** (rad 144-152):
- Andra `text-foreground/80` till `text-white` och `text-foreground` till `text-white` for bat kontrast mot 3D-bakgrund.

**`src/components/viewer/VisualizationLegendOverlay.tsx`** (rad 16-25):
- Andra initialstate till `visualizationType: 'none'` utan localStorage-lasning, sa att legend bara visas nar rumsvisualisering faktiskt aktiveras.

**`src/components/viewer/ViewerToolbar.tsx`** (rad 757):
- Andra `+ 16px` till `+ 28px` i mobile toolbar bottom-offset.

**`src/components/viewer/ViewerRightPanel.tsx`** (rad 404):
- Lagg till CSS-klass `[&>button:last-child]:hidden` pa SheetContent for att dolj den automatiska X-knappen
- Lagg till en explicit stangknapp bredvid pin-knappen i SheetTitle med ratt avstand: `gap-1` och sida vid sida layout.
