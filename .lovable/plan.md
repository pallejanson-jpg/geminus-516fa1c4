

## Fix: X-ray doljer fargade rum -- felaktig xrayMaterial-konfiguration

### Rotorsak

Fran xeokit-utvecklarens eget GitHub-issue (#175) framgar att tva konfigurationsandringar kravs for att X-ray ska fungera bra:

1. **`alphaDepthMask: false`** pa viewern -- annars maskar xray-lagret djupet och doljer solida objekt bakom det
2. **`fillAlpha = 0.1`** (inte 0.7) -- xray-lagret ska vara nastan helt genomskinligt

Nuvarande kod har `fillAlpha = 0.7` och satter aldrig `alphaDepthMask`. Det innebar att xray-lagret ar **70% ogenomskinligt** och renderas ovanpa de fargade rummen, sa de syns inte.

### Losning

Tva andringar i en fil:

**Fil: `src/components/viewer/AssetPlusViewer.tsx`**

**1. Uppdatera `changeXrayMaterial` (rad 1019-1026)**

Byt till xeokit-rekommenderade varden fran issue #175:

```typescript
xrayMaterial.fill = true;
xrayMaterial.fillAlpha = 0.1;       // Was 0.7 -- much more transparent
xrayMaterial.fillColor = [0.5, 0.5, 0.5];  // Neutral gray (was 200/255)
xrayMaterial.edges = true;
xrayMaterial.edgeAlpha = 0.2;       // Was 0.6 -- subtler edges
xrayMaterial.edgeColor = [0.3, 0.3, 0.3];  // Was 15/255
```

**2. Satt `alphaDepthMask = false` efter viewer-init (rad ~2880)**

Efter att viewern mountats, stang av djupmaskning sa att solida (fargade) objekt renderas framfor xray-objekt:

```typescript
// After changeXrayMaterialRef.current();
const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
if (xeokitViewer) {
  xeokitViewer.scene.alphaDepthMask = false;
}
```

### Ingen annan andring kravs

Insights-effekten (rad 270-419) och legend-klick (RoomVisualizationPanel rad 530-540) anvander redan korrekt `setObjectsXRayed` + `entity.xrayed = false` + `entity.colorize`. Problemet ar ENBART att xray-materialet ar for ogenomskinligt och djupmaskar fargade objekt.

### Sammanfattning

| Rad | Andring |
|-----|---------|
| 1019-1026 | `fillAlpha: 0.7 -> 0.1`, `edgeAlpha: 0.6 -> 0.2`, justerade fargvarden |
| ~2880 | Lagg till `scene.alphaDepthMask = false` efter viewer-init |

### Forvantat resultat

- Xray-objekt renderas som subtila, nastan genomskinliga konturer
- Fargade rum (fran Insights eller legend-klick) syns tydligt framfor xray-bakgrunden
- Samma beteende som i xeokits officiella BIM Viewer

