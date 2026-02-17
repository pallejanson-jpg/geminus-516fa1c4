

## Plan: Fix Split Screen alignment och kamerasynkronisering

Tva separata problem att losa:

---

### Problem 1: "Select Object" ar aktivt vid 3D-punkt-pickning

**Orsak:** I `AlignmentPointPicker.tsx` forsoks select-verktyget avaktiveras med `assetView.useTool(null)` (rad 97), men detta kanske inte fungerar med AssetPlus-viewern. Dessutom kraver valideringen att `pickResult.entity` finns (rad 131) -- dvs det KRAVS att man traffar ett objekt. Anvandaren vill bara fanga en position (koordinat pa ytan) utan att varda/highlighta nagot objekt.

**Losning:**
- Anvand `pickSurface: true` utan att krava `entity` -- tillat klick pa alla ytor
- Avaktivera object-highlighting under pickning genom att stanga av `pickable` pa alla objekt temporart ELLER anvanda `scene.pick()` med `pickSurface: true` utan att trigga selection
- Ta bort kravet pa `pickResult.entity` -- acceptera alla `worldPos`-resultat
- Skicka ett event som stanger av highlight/selection-beteendet i AssetPlusViewer under punkt-pickningen

**Filandringar:**
- `src/components/viewer/AlignmentPointPicker.tsx`:
  - I `picking3D`-effecten: Byt fran `useTool(null)` till att avaktivera highlighting direkt via xeokit (`scene.setObjectsHighlighted(ids, false)` och `scene.highlightMaterial.edges = false`)
  - Ta bort kravet pa `pickResult.entity` i bada pick-lyssnarna (rad 107 och 131-134) -- acceptera alla klick som ger `worldPos`
  - Lagg till `pickSurface: true` i `scene.pick()` (redan gjort) men tillat resultat aven utan entity
  - Vid cleanup: aterstall highlighting-beteende

---

### Problem 2: Kamerorna foljer inte varandra efter sparande

**Orsak:** I split mode renderas `Ivion360View` INTE -- SDK-containern hanteras direkt av `useIvionSdk` i UnifiedViewer. Men `useIvionCameraSync`-hooken (som pollar Ivion-position och skickar den till ViewerSyncContext) anropas BARA inne i `Ivion360View`. Darfor finns det INGEN Ivion-till-3D-synkronisering i split mode.

3D-sidan har synk (via `AssetPlusViewer.syncEnabled` + `onCameraChange`), men Ivion-sidan uppdaterar aldrig `ViewerSyncContext` med sin position.

Dessutom: efter att alignment sparas med `handleSave`, stanger `onSaved` alignment-panelen men det lokala `transform`-statet uppdateras korrekt i `UnifiedViewer`. Dock om det inte finns nagon aktiv Ivion-synk sa spelar det ingen roll.

**Losning:** Lagg till `useIvionCameraSync` direkt i `UnifiedViewerContent` for split mode. Denna hook pollar Ivion SDK:ns position, konverterar via transform, och skickar till ViewerSyncContext -- precis som den gor i `Ivion360View`.

**Filandringar:**
- `src/pages/UnifiedViewer.tsx`:
  - Importera `useIvionCameraSync`
  - Skapa en dummy `iframeRef` (kravs av hookens interface men anvands inte i SDK-mode)
  - Anropa `useIvionCameraSync` med `ivApiRef`, `enabled: isSplitMode && syncLocked`, `buildingTransform: transform`, och `ivionSiteId`
  - Detta ger bi-direktionell synk: Ivion -> ViewerSyncContext -> 3D (via befintlig `sync3DPosition`) OCH 3D -> ViewerSyncContext -> Ivion (via hookens auto-sync effekt)

---

### Sammanfattning av filandringar

| Fil | Andring |
|-----|---------|
| `src/components/viewer/AlignmentPointPicker.tsx` | Ta bort entity-krav vid 3D-pickning, avaktivera highlighting istallet for select-verktyg |
| `src/pages/UnifiedViewer.tsx` | Lagg till `useIvionCameraSync` for split mode sa att 360-positionen pollas och synkas |

### Tekniska detaljer

**AlignmentPointPicker -- ny pick-logik:**
```typescript
// Istallet for att krava entity:
if (pickResult?.worldPos) {
  // Acceptera alla ytor, aven utan entity-ID
  const picked: Vec3 = {
    x: pickResult.worldPos[0],
    y: pickResult.worldPos[1],
    z: pickResult.worldPos[2],
  };
  setBimPoint(picked);
  setStep('done');
}
```

**UnifiedViewer -- split sync:**
```typescript
const dummyIframeRef = useRef<HTMLIFrameElement>(null);
const { syncToIvion } = useIvionCameraSync({
  iframeRef: dummyIframeRef,
  ivApiRef,
  enabled: isSplitMode && syncLocked,
  ivionSiteId: buildingData?.ivionSiteId || '',
  buildingFmGuid: buildingData?.fmGuid,
  buildingTransform: transform,
});
```
