

## Synkronisera Insights-diagramfärger med 3D-visning — ✅ IMPLEMENTERAD

### Genomfört
1. ✅ **Unika färger per våning** i Energy per Floor (8-färgspalett FLOOR_COLORS)
2. ✅ **MockBadge borttagen** från Energy per Floor-kortets header
3. ✅ **HSL-till-RGB konvertering** — `hslStringToRgbFloat()` i visualization-utils.ts
4. ✅ **sessionStorage-färgkarta** — `insights_color_map` sparas vid navigering
5. ✅ **insightsMode + xray URL-params** läses i UnifiedViewer och skickas till AssetPlusViewer
6. ✅ **X-Ray + färgkodning** appliceras i AssetPlusViewer useEffect efter modell-laddning
7. ✅ **Klickbara staplar/segment** — Cell onClick på Energy-staplar och Asset Categories pie-chart
8. ✅ **XKT preload** från BuildingInsightsView

### Filer som ändrats
| Fil | Ändring |
|-----|---------|
| `visualization-utils.ts` | Ny `hslStringToRgbFloat()` funktion |
| `BuildingInsightsView.tsx` | FLOOR_COLORS, navigateToInsights3D, Cell onClick, bortagen MockBadge |
| `UnifiedViewer.tsx` | Läser insightsMode/xray params, skickar till AssetPlusViewer (desktop + mobil) |
| `AssetPlusViewer.tsx` | Nya props insightsColorMode/forceXray, useEffect för X-Ray + färgkodning |
