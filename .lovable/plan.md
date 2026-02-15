
## Implementation: 3D-prestandaoptimering + Insights-koppling

### Del 1: Prestandaoptimering med xeokit-plugins

Tre xeokit-plugins installeras efter att viewern har initialiserats, i `AssetPlusViewer.tsx`:

**1a. FastNavPlugin** -- Sanker canvas-upplosningen och stangar av dyra renderingseffekter (kanter, transparens) medan kameran ror sig. Atergar till full kvalitet nar interaktionen slutar.

```text
FastNavPlugin konfiguration:
- scaleCanvasResolution: true
- scaleCanvasResolutionFactor: 0.5 (mobil) / 0.6 (desktop)
- hideEdges: true
- hideTransparentObjects: false (behovs for rum)
- hideSAO: true
```

**1b. ViewCullPlugin** -- Döljer objekt utanfor kamerans synfalt (frustum culling) for att minska GPU-belastning.

```text
ViewCullPlugin konfiguration:
- maxTreeDepth: 20 (standard rekommendation)
```

**1c. LOD Distance Culling** -- Doljer sma objekt (t.ex. beslagsobjekt) nar kameran ar langt bort. Anvander xeokits `scene.objects` och avstandet till kameran for att toggla `culled`-egenskapen pa sma entiteter.

**Implementering:**
- Filen `src/components/viewer/AssetPlusViewer.tsx` -- Ny `useEffect` som installerar FastNavPlugin och ViewCullPlugin nar `initStep === 'ready'`. Skripten laddas fran xeokit CDN (samma som NavCubePlugin).
- Ny fil `src/hooks/usePerformancePlugins.ts` -- Hook som kapslar in plugin-installationen och LOD-logiken, med `isMobile`-flagga for aggressivare skalning pa mobil.

### Del 2: "Visa i 3D"-knappar pa BuildingInsightsView

Lagg till kontextuella knappar pa KPI-kort och diagramkort som navigerar till 3D-viewern med ratt kontext.

**Knappar:**
- **Rooms KPI-kort**: Klick oppnar 3D med rumsvisualisering (yta/NTA) forvald
- **Assets KPI-kort**: Klick oppnar 3D med fokus pa byggnaden
- **Energy per Floor-diagram (staplarna)**: Klick pa en stapel oppnar 3D med den vaningen isolerad (Solo mode)
- **Room Types-diagram**: Klick oppnar 3D med rumsvisualisering aktiv

**Navigation:** Anvander befintliga URL-parametrar:
```text
/split-viewer?building={fmGuid}&mode=3d&visualization=temperature
/split-viewer?building={fmGuid}&mode=3d&entity={floorFmGuid}
```

**Ny URL-parameter:** `visualization` -- Nar denna finns, aktiverar `AssetPlusViewer` automatiskt rumsvisualisering av angiven typ vid laddning.

**Filer att andra:**
- `src/components/insights/BuildingInsightsView.tsx` -- Lagg till `onClick`-handlers pa KPI-kort och diagramkort som anropar `navigate()` med ratt parametrar. Importera `Eye`-ikon fran lucide for visuell indikation.
- `src/pages/UnifiedViewer.tsx` -- Lasa ny `visualization`-parameter fran URL och skicka vidare till `AssetPlusViewer`.
- `src/components/viewer/AssetPlusViewer.tsx` -- Ny prop `initialVisualization?: VisualizationType`. Nar satt, dispatchar `VISUALIZATION_STATE_CHANGED`-event vid laddning for att aktivera rumsvisualisering automatiskt.

### Del 3: Interaktiv diagramkoppling

Nar anvandaren klickar pa en stapel i "Energy per Floor"-diagrammet navigeras de till 3D-viewern med den vaningen isolerad. Klick pa en sektor i pajdiagrammet (t.ex. Room Types) navigerar till 3D med rumsvisualisering aktiv.

**Implementering i `BuildingInsightsView.tsx`:**
- `onClick`-handler pa `<Bar>` i BarChart: hittar vaningens `fmGuid` fran `allData` baserat pa staplans namn och navigerar med `entity`-parametern.
- `onClick`-handler pa `<Pie>` i PieChart (Room Types): navigerar till 3D med `visualization=area`.

### Del 4: Responsivitet (desktop + mobil)

- Alla "Visa i 3D"-knappar renderas som smala ikoner pa mobil (kompakta) och med text pa desktop.
- Prestandaplugins anvander mer aggressiva installningar pa mobil (lagre resolution scaling, aktiverat frustum culling).
- KPI-kort-knappar far `touch-action: manipulation` for snabb respons pa mobil.

### Sammanfattning av filandringar

| Fil | Andringar |
|---|---|
| `src/hooks/usePerformancePlugins.ts` | **NY** -- Hook for FastNavPlugin + ViewCullPlugin + LOD |
| `src/components/viewer/AssetPlusViewer.tsx` | Anropa `usePerformancePlugins`, ny prop `initialVisualization` |
| `src/components/insights/BuildingInsightsView.tsx` | "Visa i 3D"-knappar pa KPI-kort och diagram med `navigate()` |
| `src/pages/UnifiedViewer.tsx` | Lasa `visualization`-parameter fran URL, skicka till viewer |
