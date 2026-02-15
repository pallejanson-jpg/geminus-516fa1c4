

## Fix: Insights-färger syns inte i 3D-viewern

### Rotorsak

Det finns en **race condition** i `AssetPlusViewer.tsx`. Nar modellen laddar klart kor `handleAllModelsLoaded` (rad 1532-1556) som **explicit doljer alla IfcSpace-entiteter** och anropar `assetViewer.onShowSpacesChanged(false)`. Aven om insights-effekten (rad 270-419) sedan kor och satter `visible = true` pa rummen, sa kan Asset+-bibliotekets interna `onShowSpacesChanged(false)` asynkront aterstalla synligheten.

Dessutom: i `handleAllModelsLoaded` doljs rummen **fore** `spacesCacheReady` satts till `true`. Sa ordningen ar:
1. `handleAllModelsLoaded` -- doljer alla rum, anropar `onShowSpacesChanged(false)`
2. Cache-effekten bygger cachen, satter `spacesCacheReady = true`
3. Insights-effekten kor, visar och fargar rum
4. Men Asset+-bibliotekets asynkrona svar pa `onShowSpacesChanged(false)` kan overskriva steg 3

### Losning

**Fil: `src/components/viewer/AssetPlusViewer.tsx`**

**1. Skippa default space-hiding nar insightsColorMode ar aktivt**

I `handleAllModelsLoaded` (rad 1532-1556), wrappa "hide spaces"-blocket i en villkorskontroll:

```
// Rad 1532-1556: Lagg till guard
if (!insightsColorMode) {
  // CRITICAL: Ensure spaces (rooms) are hidden by default
  try {
    const assetViewer = viewer?.assetViewer;
    if (assetViewer?.onShowSpacesChanged) {
      assetViewer.onShowSpacesChanged(false);
    }
    // ... hide IfcSpace entities ...
  } catch {}
}
```

Detta forhindrar att Asset+-biblioteket doljer rum nar vi vet att insights-effekten ska visa dem.

**2. Lagg till en forsenkning i insights-effekten**

For att garantera att alla asynkrona modell-laddnings-callbacks har exekverat klart, lagg till en kort `setTimeout` (100ms) i insights-effekten innan farglaggningen appliceras. Detta ger modellen tid att stabiliseras:

```
useEffect(() => {
  if (!insightsColorMode) return;
  if (!spacesCacheReady) return;
  if (modelLoadState !== 'loaded' || initStep !== 'ready') return;

  // Delay to ensure handleAllModelsLoaded has fully completed
  const timer = setTimeout(() => {
    // ... befintlig farglaggningslogik ...
    // EXTRA: Anropa onShowSpacesChanged(true) EFTER farglaggning
    try {
      const assetViewer = viewer?.assetViewer;
      assetViewer?.onShowSpacesChanged?.(true);
    } catch {}
  }, 150);
  return () => clearTimeout(timer);
}, [insightsColorMode, insightsColorMapProp, spacesCacheReady, modelLoadState, initStep]);
```

**3. Satt showSpaces INNAN farglaggning**

Flytta `setShowSpaces(true)` och `onShowSpacesChanged(true)` till **fore** farglaggningen i insights-effekten, sa att Asset+-biblioteket oppnar rum-lagret innan vi satter enskilda attribut. Nuvarande kod (rad 412-417) gor det efter, men det maste ske fore.

### Rekommendation om X-Ray vs visibility

Istallet for X-Ray-lage (som gor alla objekt halvtransparenta), rekommenderar jag att helt enkelt **dolja** alla icke-rum-objekt (`visible = false`) och visa enbart rummen med `visible = true` + `colorize`. Detta ar redan koden gor (rad 306-307), men det fungerar inte pa grund av racen ovan.

Nar racen ar fixad kommer rummen synas tydligt utan vaggar/dorrar/fonster -- precis som onskat. X-Ray-attributet ar onodig dar och kan tas bort fran `scene.setObjectsXRayed(allIds, true)` (rad 308). Det racker att dolja objekten.

### Sammanfattning

| Fil | Andring |
|-----|---------|
| `AssetPlusViewer.tsx` rad 1532-1556 | Wrappa space-hiding i `if (!insightsColorMode)` |
| `AssetPlusViewer.tsx` rad 270-419 | Lagg till 150ms setTimeout, flytta `onShowSpacesChanged(true)` fore farglaggning, ta bort `setObjectsXRayed` |

### Forvantad ordning efter fix
1. `handleAllModelsLoaded` -- skippar space-hiding (insightsColorMode ar satt)
2. Cache-effekten bygger cachen, satter `spacesCacheReady = true`
3. Insights-effekten vantar 150ms, sedan:
   a. Anropar `onShowSpacesChanged(true)` -- oppnar rum-lagret i Asset+
   b. Doljer ALLA objekt (`visible = false`)
   c. Visar och fargar enbart matchande rum
4. Resultatet: bara rum syns, fargade med diagrammets farger
