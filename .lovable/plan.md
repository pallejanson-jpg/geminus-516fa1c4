

## Fix: Insights-till-3D infargning + interaktiv legend + ta bort Demo-badges

### Problem 1: Insights-farger syns aldrig i 3D

**Rotorsak:** `handleAllModelsLoaded` (rad 1481) ar en `useCallback` med dependency-array `[executeDisplayAction, transparentBackground, ghostOpacity]` (rad 1637). Den inkluderar INTE `insightsColorMode`. Det innebar att `if (!insightsColorMode)`-guarden (rad 1532) alltid laser det gamla closure-vardet `undefined`, oavsett vad propen ar. Darmed anropas alltid `onShowSpacesChanged(false)` som doljer rummen, och Asset+-bibliotekets asynkrona response overskriver insights-effektens farglaggning 150ms senare.

**Fix:** Anvand en `useRef` for att bypassa stale closure.

### Problem 2: Legend-klick i rumsvisualisering

Idag valjer legend-klick bara rum (`setObjectsSelected`). Onskemal: klicka pa t.ex. "20 grader" ska visa ENBART de rummen fargade, medan alla andra objekt blir xray (halvtransparenta). 

Xeokit stodjer `xrayed` + `colorize` + `visible` pa samma entity. Nyckeln ar att xray-materialet inte overskriver `colorize` -- sa man kan:
- Satt alla objekt till `xrayed = true` (halvtransparenta)
- For matchande rum: `xrayed = false`, `colorize = rgb`, `visible = true`
- Resultat: fargade rum sticker ut, resten ar genomskinlig

### Problem 3: Demo-badges

`MockBadge`-komponenten och alla anvandningar ska bort.

---

### Fil 1: `src/components/viewer/AssetPlusViewer.tsx`

**1a. Lagg till ref for insightsColorMode (rad ~175)**

```text
const insightsColorModeRef = useRef(insightsColorMode);
```

**1b. Synka ref med prop (rad ~187)**

```text
useEffect(() => { insightsColorModeRef.current = insightsColorMode; }, [insightsColorMode]);
```

**1c. Byt closure-variabel till ref i handleAllModelsLoaded (rad 1532)**

Byt `if (!insightsColorMode)` till `if (!insightsColorModeRef.current)`.
Ingen andring i dependency-arrayen -- refen ar stabil.

**1d. Uppdatera insights-effekten: xray-logik (rad 270-417)**

Istallet for att bara dolja icke-matchande objekt (`visible = false`), anvand xray-kombinationen:

```text
// Steg 1: Satt ALLA objekt till xrayed + behall visible
scene.setObjectsXRayed(allIds, true);

// Steg 2: For matchande rum/objekt:
entity.xrayed = false;   // Stang av xray
entity.colorize = rgb;   // Farglagg
entity.visible = true;   // Saker synlig
entity.opacity = 0.85;
```

Detta ger exakt den onskan effekten: fargade rum sticker ut, allt annat ar halvtransparent.

---

### Fil 2: `src/components/viewer/RoomVisualizationPanel.tsx`

**2a. Uppdatera legend-klick-hanteraren (rad 502-540)**

Nar en legend-stop klickas:
- Om klick aktiverar (inte avaktiverar): satt alla objekt till `xrayed = true`, sedan for matchande rum: `xrayed = false`
- Om klick avaktiverar (toggle off): aterstall `xrayed = false` pa alla objekt

Befintlig `setObjectsSelected` behalles ocksa for markerings-effekten, men xray gor att de icke-matchande rummen blir genomskinliga.

```text
const handleLegendSelect = (e: CustomEvent<LegendSelectDetail>) => {
  const { rangeMin, rangeMax, type } = e.detail;
  // ... befintlig matchning ...

  const allIds = scene.objectIds || [];
  
  if (idsToSelect.length > 0) {
    // Xray allt
    scene.setObjectsXRayed(allIds, true);
    // Ta bort xray pa matchande rum
    scene.setObjectsXRayed(idsToSelect, false);
    // Markera dem
    scene.setObjectsSelected(idsToSelect, true);
  } else {
    // Avaktivera: ta bort xray fran allt
    scene.setObjectsXRayed(allIds, false);
  }
};
```

Lagg till cleanup: nar legend-toggle staengs av, aterstall xray pa alla objekt.

---

### Fil 3: `src/components/insights/BuildingInsightsView.tsx`

**3a. Ta bort MockBadge-komponenten (rad 40-45)**

**3b. Ta bort alla anvandningar av MockBadge:**
- `isMock`-propertyn fran KPI-kort
- `{kpi.isMock && <MockBadge />}` rendering
- `<MockBadge />` pa Energy Distribution och Monthly Energy Trend
- `text-purple-400`-klasser fran titlar och varden

---

### Sammanfattning

| Fil | Andring |
|-----|---------|
| `AssetPlusViewer.tsx` | Ref for `insightsColorMode` (fixar stale closure), xray-logik i insights-effekten |
| `RoomVisualizationPanel.tsx` | Legend-klick togglar xray pa icke-matchande objekt |
| `BuildingInsightsView.tsx` | Ta bort MockBadge + lila text-styling |

### Forvantad ordning efter fix

1. `handleAllModelsLoaded` laser `insightsColorModeRef.current` -- ser korrekt varde
2. Om insights ar aktivt: skippar `onShowSpacesChanged(false)`
3. Cache byggs, `spacesCacheReady = true`
4. Insights-effekten vantar 150ms, sedan:
   - Aktiverar rum-lagret
   - Satter alla objekt till xrayed
   - Stanger av xray + fargar matchande rum
5. Resultat: bara rum syns fargade, allt annat halvtransparent

### Legend-klick (rumsvisualisering)

1. Klick pa "20" i temperaturskalan
2. Alla objekt far `xrayed = true`
3. Rum med ~20 grader: `xrayed = false` + markerade
4. Resultat: 20-graders-rummen sticker ut, resten ar genomskinlig
5. Klick igen: xray aterstaells, allt ser normalt ut

