

# Fix: Rumsetiketter visas för alla våningar på mobil

## Problem

När ett enskilt våningsplan väljs på mobil visas rumsetiketter för ALLA rum i hela byggnaden, inte bara för den valda våningen. Skärmbilden visar hundratals överlappande etiketter från alla 10 våningar.

## Grundorsak

`handleMobileFloorToggle` i `AssetPlusViewer.tsx` (rad 2258-2289) togglar bara synligheten av 3D-geometri men **dispatchar aldrig `FLOOR_SELECTION_CHANGED_EVENT`**. Det eventet är det som triggar `updateFloorFilter` i `useRoomLabels`-hooken (rad 514-517), som filtrerar vilka rumsetiketter som visas.

Desktop-versionen (`FloatingFloorSwitcher`) dispatchar detta event korrekt, men den mobila kodvägen saknar det helt.

## Lösning

Lägg till dispatch av `FLOOR_SELECTION_CHANGED_EVENT` i `handleMobileFloorToggle` efter att synligheten ändrats. Detta synkroniserar rumsetiketter, ceiling clipping och andra lyssnare.

## Tekniska ändringar

### Fil: `src/components/viewer/AssetPlusViewer.tsx`

**Rad 2258-2289 -- `handleMobileFloorToggle`:**

Efter den befintliga `setMobileFloors`-uppdateringen (rad 2283-2285), lägg till:

```text
1. Beräkna nya synliga våningar från uppdaterat state
2. Samla fmGuids för synliga våningar
3. Dispatcha FLOOR_SELECTION_CHANGED_EVENT med:
   - visibleFloorFmGuids: lista av synliga våningars fmGuid
   - isAllFloorsVisible: true om alla är synliga
   - floorId: den valda våningens id (för solo-läge)
   - bounds: beräknad om solo-läge (för ceiling clipping)
```

Konkret ändring (pseudokod):

```text
handleMobileFloorToggle(floorId, visible):
  ... befintlig toggleHierarchy-logik ...
  ... befintlig setMobileFloors ...

  // NY KOD:
  const newFloors = mobileFloors.map(f =>
    f.id === floorId ? {...f, visible} : f
  );
  const visibleFloors = newFloors.filter(f => f.visible);
  const isAllVisible = visibleFloors.length === newFloors.length;
  const isSolo = visibleFloors.length === 1;

  const visibleFmGuids = visibleFloors.map(f => f.fmGuid);

  window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
    detail: {
      floorId: isSolo ? visibleFloors[0].id : null,
      visibleFloorFmGuids: visibleFmGuids,
      visibleMetaFloorIds: visibleFloors.map(f => f.id),
      isAllFloorsVisible: isAllVisible,
    }
  }));
```

Detta gör att den befintliga lyssnaren `handleFloorSelectionChange` (rad 494-532) automatiskt anropar `updateFloorFilter` med rätt vånings-GUIDs, som i sin tur filtrerar rumsettiketter till bara de valda våningarna.

## Effekt

- Rumsetiketter filtreras korrekt till valda våningar på mobil
- Ceiling clipping synkroniseras med mobila val
- Ingen ändring av desktop-beteende
- En ändring i en fil, ca 15 nya rader

