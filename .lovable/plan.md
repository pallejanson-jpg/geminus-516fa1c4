

# Plan: Standalone FMA 2D-rutt + Förbättra SplitPlanView-kvalitet

## Du har rätt

2D/3D split renderar `SplitPlanView.tsx` (xeokit `createStoreyMap()` → PNG). **Inte** FM Access. FMA 2D Panel (`FmAccess2DPanel.tsx`) importeras i `UnifiedViewer.tsx` men renderas aldrig någonstans.

## Del 1: Ny standalone-rutt för FMA 2D Viewer

Skapa `/fma-2d?building=<fmGuid>&floor=<floorName>` som renderar `FmAccess2DPanel` i fullskärm, så du kan testa den direkt i adressfältet.

| Fil | Ändring |
|-----|---------|
| `src/pages/FmAccess2DStandalone.tsx` | Ny sida: läser `building` och `floor` från query params, renderar `FmAccess2DPanel` i full viewport |
| `src/App.tsx` | Lägg till `<Route path="/fma-2d">` med lazy-load och `ProtectedRoute` |

## Del 2: Förbättra SplitPlanView-kvalitet

Nuvarande kod (rad 413):
```typescript
const width = container ? Math.min(container.clientWidth * 3, 4000) : 1600;
```

Det genererar redan en ganska stor PNG, men kvaliteten begränsas av att xeokit rasteriserar 3D-geometri ovanifrån. Ytterligare förbättringar:

### A. Höj kontrast och skärpa i renderad PNG
- **Förstärk väggfärgning**: Nuvarande `edgeWidth: 2` kan ökas till `3–4` och svarta väggar kan vara tjockare.
- **Höj kontrast på golv/rum**: Sänk opacity på icke-vägg-objekt från `0.18` till `0.08` så väggar framträder tydligare.
- **Ljusare bakgrund**: Sätt scene-bakgrund till vit innan capture för renare planritning.

### B. Använd CSS `image-rendering: crisp-edges`
PNG:en renderas i en `<img>`-tagg. Genom att lägga `image-rendering: crisp-edges` på den blir linjer skarpare vid zoom, istället för default bilinear blur.

### C. Regenerera vid zoom (optional, dyrare)
Vid hög zoom kan vi re-rendera `createStoreyMap()` med ännu högre width (t.ex. 6000–8000px). Det ger bättre detalj men kostar mer.

**Notera**: Xeokit `createStoreyMap()` genererar alltid en rasteriserad bild — det finns ingen vektor-output. Så det blir aldrig lika skarpt som FMA:s vektorgrafik. Men med dessa tweaks blir det signifikant bättre.

| Fil | Ändring |
|-----|---------|
| `SplitPlanView.tsx` | Öka `edgeWidth` till 3, sänk slab/space opacity till 0.08, sätt vit bakgrund innan capture, CSS `crisp-edges` på img |

## Sammanfattning

3 filer ändras/skapas. Ingen funktionell brytning — bara skarpare 2D-grafik och en testbar FMA-rutt.

