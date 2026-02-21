

## 2D-lagesfoerrbattringar -- 4 deluppgifter

### 1. Ren 2D: Isolera vald vaning vid start

**Problem**: Nar man navigerar fran en byggnad med en specifik vaning (?building=X&floor=Y), visas hela byggnaden i 2D istallet for att isolera den valda vaningen.

**Orsak**: `UnifiedViewer` laser `floorFmGuid` fran URL-parametern `floor`, men nar 2D-laget aktiveras skickas den aldrig vidare till `ViewerToolbar.handleViewModeChange('2d')`. Toolbaren kollar `currentFloorId` som ar null vid forsta start.

**Losning**: 
- I `UnifiedViewer.tsx`: Nar `viewMode` satts till `'2d'` OCH `floorFmGuid` finns i URL:en, dispatcha ett `FLOOR_SELECTION_CHANGED_EVENT` med `visibleFloorFmGuids: [floorFmGuid]` och `isSoloFloor: true` kort efter 2D-toggle-eventet (med 500ms delay). Detta synkar ViewerToolbar och FloorVisibilitySelector.
- I `ViewerToolbar.tsx`: Se till att `handleViewModeChange('2d')` respekterar det inkommande floor-selection-eventet for klippning.

**Fil**: `src/pages/UnifiedViewer.tsx`

---

### 2. Flytande vaningsvaljare i 2D-lage

**Problem**: FloatingFloorSwitcher (pill-knappar) togs bort fran 2D-flode men behovs for att byta vaning i planvy.

**Losning**: 
- FloatingFloorSwitcher ar redan renderad i `AssetPlusViewer.tsx` (rad 4028-4036) men enbart for desktop (`!isMobile`). 
- For mobilt: Lagg till `FloatingFloorSwitcher` aven i `MobileUnifiedViewer` nar `viewMode === '2d'`, med kompakt styling (mindre pills, horisontellt langst ner).
- Gor komponentens styling responsiv: lagg till en `compact`-prop som minskar pill-storlek (h-7, text-xs) for mobilt.

**Filer**: 
- `src/components/viewer/FloatingFloorSwitcher.tsx` -- lagg till `compact`-prop
- `src/pages/UnifiedViewer.tsx` -- rendera FloatingFloorSwitcher i MobileUnifiedViewer for 2D

---

### 3. Dolda objekt (slabs) pa mobil i 2D

**Problem**: Pa mobil dols inte IfcSlab/IfcRoof-objekt i 2D-laget korrekt.

**Orsak**: `VIEW_MODE_2D_TOGGLED_EVENT` dispatchas korrekt fran UnifiedViewer, och `ViewerToolbar` lyssnar pa det. Men i mobilversionen renderas `AssetPlusViewer` utan den fulla toolbar-kontexten -- `ViewerToolbar` renderas inuti `AssetPlusViewer` (rad 4041-4049), sa den borde ta emot eventet. 

Trolig orsak: Timingproblem -- eventet dispatchas innan ViewerToolbar ar mountad/redo. Losningen ar att lata ViewerToolbar kontrollera sin `viewMode`-state mot det faktiska laget vid mount, och om den missar eventet, applicera 2D-stilen retroaktivt.

**Losning**: I `ViewerToolbar.tsx`, lagg till en effect som vid `isViewerReady` kollar om externt 2D-lage ar aktivt (via en global flag eller genom att lyssna pa `VIEW_MODE_2D_TOGGLED_EVENT` med en ref som sparar senaste state). Om viewer blir redo medan 2D ar aktivt, kor `handleViewModeChange('2d')` automatiskt.

**Fil**: `src/components/viewer/ViewerToolbar.tsx`

---

### 4. Dubblerad 3D ModeButton

**Bug**: I mode-switchern pa desktop (rad 417-418) finns tva identiska `ModeButton mode="3d"`. Den ena ska vara `mode="2d"` men bada ar `3d`. 

```
<ModeButton mode="3d" ... label="3D" />   // rad 417 -- borde vara 2D-knappen?
<ModeButton mode="3d" ... label="3D" />   // rad 418 -- duplikat
```

Rad 416 har redan en 2D-knapp, sa rad 417-418 har en extra dubblerad 3D-knapp.

**Losning**: Ta bort den dubblerade raden 418.

**Fil**: `src/pages/UnifiedViewer.tsx`

---

### Sammanfattning av filandringar

| Fil | Andring |
|---|---|
| `src/pages/UnifiedViewer.tsx` | (1) Dispatcha floor-selection vid 2D-start med floor-param, (2) FloatingFloorSwitcher i MobileUnifiedViewer, (3) Ta bort dubblerad 3D ModeButton |
| `src/components/viewer/ViewerToolbar.tsx` | (3) Retroaktiv 2D-applicering vid viewer-ready, sakerstall att slabs doljs pa mobil |
| `src/components/viewer/FloatingFloorSwitcher.tsx` | (2) Lagg till `compact`-prop for mindre pills pa mobil |

