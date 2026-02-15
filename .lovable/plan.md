

## Fix: Rum fargas inte vid xray -- xrayMaterial maste ateranvandas vid ratten tidpunkt

### Analys

Rumsvisualisering (RoomVisualizationPanel) fungerar -- den anvander `entity.colorize` + `entity.opacity` UTAN xray. Men insights-effekten och legend-klick anvander `setObjectsXRayed` + `entity.xrayed = false` + `entity.colorize`, och dar syns inga farger.

Problemet ar troligen att **Asset+-biblioteket aterstaller/overskriver xrayMaterial-installningarna** efter att `changeXrayMaterial` korts vid mount (rad 2881). Nar insights-effekten sedan aktiverar xray 150ms senare, har `fillAlpha` och `alphaDepthMask` aterats till standardvarden (ogenomskinliga), och de fargade rummen doljs.

### Losning

Applicera xrayMaterial-konfigurationen **direkt innan xray anvands** -- inte bara vid mount. Det garanterar att installningarna ar aktiva nar de behovs.

---

### Fil 1: `src/components/viewer/AssetPlusViewer.tsx`

**1a. Extrahera xray-konfiguration till en hjalp-funktion (bredvid `changeXrayMaterial`, rad ~1012)**

Skapa en ny funktion `ensureXrayConfig` som bade satter xrayMaterial OCH `alphaDepthMask`:

```typescript
const ensureXrayConfig = useCallback((scene: any) => {
  const xrayMaterial = scene?.xrayMaterial;
  if (xrayMaterial) {
    xrayMaterial.fill = true;
    xrayMaterial.fillAlpha = 0.1;
    xrayMaterial.fillColor = [0.5, 0.5, 0.5];
    xrayMaterial.edges = true;
    xrayMaterial.edgeAlpha = 0.2;
    xrayMaterial.edgeColor = [0.3, 0.3, 0.3];
  }
  if (scene) {
    scene.alphaDepthMask = false;
  }
}, []);
```

**1b. Anropa `ensureXrayConfig` i insights-effekten (rad ~304, inuti setTimeout)**

Direkt efter att `scene` hamtats (rad 304), och INNAN `setObjectsXRayed` anropas (rad 318):

```typescript
const scene = xeokitViewer.scene;
// Re-apply xray config right before use (Asset+ may have overridden it)
ensureXrayConfig(scene);
```

**1c. Behall befintlig mount-konfiguration (rad 2880-2888)**

`changeXrayMaterialRef.current()` och `alphaDepthMask = false` vid mount behalles som initial setup.

---

### Fil 2: `src/components/viewer/RoomVisualizationPanel.tsx`

**2a. Lagg till `ensureXrayConfig` fore legend-klick xray (rad ~530)**

Fore `scene.setObjectsXRayed(allIds, true)` pa rad 533, anropa samma xray-konfiguration:

```typescript
// Ensure xray material is properly configured before use
const xrayMaterial = scene?.xrayMaterial;
if (xrayMaterial) {
  xrayMaterial.fill = true;
  xrayMaterial.fillAlpha = 0.1;
  xrayMaterial.fillColor = [0.5, 0.5, 0.5];
  xrayMaterial.edges = true;
  xrayMaterial.edgeAlpha = 0.2;
  xrayMaterial.edgeColor = [0.3, 0.3, 0.3];
}
scene.alphaDepthMask = false;
```

---

### Sammanfattning

| Fil | Andring |
|-----|---------|
| `AssetPlusViewer.tsx` | Ny `ensureXrayConfig`-funktion, anropas i insights-effekten fore `setObjectsXRayed` |
| `RoomVisualizationPanel.tsx` | Samma xray-konfiguration appliceras fore legend-klickens `setObjectsXRayed` |

### Varfor detta loser problemet

Asset+-biblioteket kan aterstalla xrayMaterial till sina standardvarden (hog opacity, `alphaDepthMask = true`) vid modell-laddning eller andra interna operationer. Genom att konfigurera om xrayMaterial **direkt innan** vi aktiverar xray, garanterar vi att de korrekta vardena fran xeokit-issue #175 anvands.

