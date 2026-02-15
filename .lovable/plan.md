
## Implementation: 3D-prestandaoptimering + Insights-koppling — KLART ✅

### Del 1: Prestandaoptimering med xeokit-plugins ✅
- `src/hooks/usePerformancePlugins.ts` — Ny hook med FastNavPlugin, ViewCullPlugin och LOD distance culling
- Integrerad i `AssetPlusViewer.tsx` via `usePerformancePlugins()`

### Del 2: "Visa i 3D"-knappar på BuildingInsightsView ✅
- KPI-kort (Rooms, Assets, Area, Floors) har klickbara "Visa i 3D"-knappar med hover-effekt
- Room Types-diagram navigerar till 3D med `visualization=area`

### Del 3: Interaktiv diagramkoppling ✅
- Energy per Floor stapeldiagram: klick på stapel navigerar till 3D med den våningen isolerad
- Room Types pie chart: klick öppnar 3D med rumsvisualisering aktiv

### Del 4: Ny URL-parameter `visualization` ✅
- `UnifiedViewer.tsx` läser `visualization` från URL
- `AssetPlusViewer.tsx` har ny prop `initialVisualization` som dispatchar `INITIAL_VISUALIZATION_REQUESTED`
- Fungerar på både desktop och mobil
