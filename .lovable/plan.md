

## Fix: Demo-badges bort + Insights-till-3D-fargkodning fungerar inte (closure-bugg)

### Del 1: Ta bort Demo-badges

**Fil: `src/components/insights/BuildingInsightsView.tsx`**

- Ta bort `MockBadge`-komponenten (rad 40-45)
- Ta bort `isMock`-propertyn fran KPI-korten (rad 341-342) och tillhorande rendering `{kpi.isMock && <MockBadge />}` (rad 349)
- Ta bort `<MockBadge />`-anvandning pa Energy Distribution (rad 433) och Monthly Energy Trend (rad 472)
- Ta bort `text-purple-400`-klassen fran "Energy Distribution" (rad 432) och "Monthly Energy Trend" (rad 471) titlarna sa de far normal farg
- Ta bort `text-purple-400`-formatet fran KPI-varden som ar markerade som mock (rad 353-354)

### Del 2: Insights-farger syns inte — stale closure i handleAllModelsLoaded

**Rotorsak identifierad:**

`handleAllModelsLoaded` (rad 1481) ar en `useCallback` med dependency-array `[executeDisplayAction, transparentBackground, ghostOpacity]` (rad 1637). Den inkluderar **inte** `insightsColorMode`. Det innebar att `if (!insightsColorMode)`-guarden (rad 1532) laser ett **gammal closurevarde** — den ser alltid `undefined` for `insightsColorMode`, oavsett vad propen faktiskt ar.

Darmed koter alltid `onShowSpacesChanged(false)` och doljer alla rum, trots att insights-laget ar aktivt. Den efterfoljande insights-effekten (rad 270-417) kor 150ms senare och satter rum till visible, men Asset+-bibliotekets asynkrona svar pa `onShowSpacesChanged(false)` overskriver det.

**Losning:**

I `handleAllModelsLoaded`, anvand en **ref** istallet for closure-variabeln:

1. Lagg till `const insightsColorModeRef = useRef(insightsColorMode);` och en `useEffect` som haller refen i synk
2. I `handleAllModelsLoaded` (rad 1532): byt `if (!insightsColorMode)` till `if (!insightsColorModeRef.current)`
3. Detta kravet INGA andringar i dependency-arrayen (som skulle destabilisera callbacken och riskera re-init)

**Fil: `src/components/viewer/AssetPlusViewer.tsx`**

Andringar:
- Rad ~175: Lagg till `const insightsColorModeRef = useRef(insightsColorMode);`
- Rad ~187: Lagg till `useEffect(() => { insightsColorModeRef.current = insightsColorMode; }, [insightsColorMode]);`
- Rad 1532: Byt `if (!insightsColorMode)` till `if (!insightsColorModeRef.current)`

### Sammanfattning

| Fil | Andring |
|-----|---------|
| `BuildingInsightsView.tsx` | Ta bort MockBadge-komponenten och alla anvandningar, samt lila text-styling |
| `AssetPlusViewer.tsx` | Fixa stale closure: anvand ref for `insightsColorMode` i `handleAllModelsLoaded` |

### Forvantad ordning efter fix
1. `handleAllModelsLoaded` laser `insightsColorModeRef.current` — ser korrekt varde
2. Om insights-lage ar aktivt: skippar `onShowSpacesChanged(false)` och doljning av rum
3. Cache-effekten bygger cachen, satter `spacesCacheReady = true`
4. Insights-effekten vantar 150ms, oppnar rum-lagret, doljer allt annat, fargar rummen
5. Resultat: bara rum syns, fargade med diagrammets farger

