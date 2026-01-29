
# Plan: Fixa "Visa rum" synlighet och klippning i 3D-visaren

## Status: ✅ IMPLEMENTERAT

Följande ändringar har gjorts:

### Del 1: Fixa "Visa rum" standard och våningsplansfiltrering ✅

1. **Centraliserat `showSpaces` state i AssetPlusViewer.tsx**
   - Ny state: `const [showSpaces, setShowSpaces] = useState(false)` - alltid AV som standard
   - Ny funktion: `filterSpacesToVisibleFloors(visibleFloorGuids, forceShow)` - filtrerar rum baserat på synliga våningsplan
   - Ny funktion: `handleShowSpacesChange(show)` - central hanterare som anropar Asset+ API och filtrerar rum
   - Ny funktion: `handleVisibleFloorsChange(floorIds)` - uppdaterar synliga våningsplan och filtrerar rum om showSpaces är PÅ

2. **Uppdaterat VisualizationToolbar.tsx som controlled component**
   - Nya props: `showSpaces?: boolean` och `onShowSpacesChange?: (show: boolean) => void`
   - Använder controlled state om props finns, annars lokal state som fallback
   - Tar bort automatisk avstängning av showSpaces vid våningsbyte (nu hanteras i parent)

### Del 2: Fixa 3D Solo-mode klippning vid våningsgräns ✅

1. **Ny funktion i useSectionPlaneClipping.ts**
   - `calculateClipHeightFromFloorBoundary(floorId)` - beräknar klipphöjd baserat på nästa vånings golvnivå
   - Sorterar alla våningsplan efter elevation (minY)
   - Returnerar nästa vånings minY för klippning
   - För översta våningen: returnerar egen maxY + 0.1

2. **Uppdaterad `applySectionPlane` funktion**
   - I 'ceiling' mode (3D Solo): använder `calculateClipHeightFromFloorBoundary` för korrekt våningsgräns
   - I 'floor' mode (2D): använder fortfarande `bounds.minY + floorCutHeight`

### Del 3: Dataflöde ✅

```
AssetPlusViewer (showSpaces state, filterSpacesToVisibleFloors)
       ↓
VisualizationToolbar (controlled showSpaces prop)
       ↓
Asset+ Viewer API (onShowSpacesChanged)
```

---

## Förväntade resultat

1. ✅ **"Visa rum" alltid AV** - Som standard och efter modell/våningsbyte
2. ✅ **Korrekt våningsfiltrering** - Endast rum från valda våningsplan visas
3. ✅ **Klippning vid våningsgräns** - Väggar klipps vid nästa vånings golv, inte vid geometri-max
4. ✅ **2D-slider** - Klipphöjden uppdateras i realtid (befintlig implementation)

---

## Filändringar

| Fil | Status |
|-----|--------|
| `src/components/viewer/AssetPlusViewer.tsx` | ✅ Uppdaterad |
| `src/components/viewer/VisualizationToolbar.tsx` | ✅ Uppdaterad |
| `src/hooks/useSectionPlaneClipping.ts` | ✅ Uppdaterad |
