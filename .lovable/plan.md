

## Fix: Slabs blockerar 2D-vy och dolda slabs gor rum oklickbara

### Rotorsak

I xeokit ar `scene.pick()` beroende av att entity ar `visible = true`. Det finns tva problem:

1. **Slabs blockerar**: Nar slabs ar synliga i 2D ligger de ovanfor rummen och tar emot alla klick istallet for rummen under
2. **Dolda slabs = oklickbara rum**: Nar slabs doljs (`visible = false`) passerar pick-stralen rakt igenom, men IfcSpace-entities ar OCKSA dolda (`showSpaces` startar som `false`) -- sa det finns inget att klicka pa

### Losning -- tva delar

**A) Slabs i 2D: Osynliga MEN inte pick-blockerande**

Istallet for att bara satta `visible = false` pa slabs, anvand `pickable = false` PLUS extremt lag opacity:

```text
entity.visible = true       (behalls synlig for xeokit-rendering)
entity.pickable = false     (blockerar inte picks pa objekt under)
entity.opacity = 0.0        (helt transparent -- syns inte visuellt)
entity.edges = false        (inga kanter syns heller)
```

Detta gor att slabs inte syns och inte blockerar klick, men xeokit behover inte hantera dem som "borta".

**B) IfcSpace i 2D: Gor rum klickbara automatiskt**

Nar 2D-laget aktiveras, gor IfcSpace-entities synliga med extremt lag opacity (0.02) sa de fungerar som osynliga klickytor:

```text
entity.visible = true
entity.pickable = true  
entity.opacity = 0.02       (nastan osynligt men pickable)
entity.colorize = [0.5, 0.7, 0.9]  (ljusbla om nagot syns)
```

Nar anvandaren sedan aktiverar "Visa rum" (showSpaces) far rummen full opacitet som vanligt.

### Implementation

**Fil: `src/components/viewer/ViewerToolbar.tsx`**

I `handleViewModeChange('2d')`:

1. Andra slab-doljningen fran:
   - `scene.setObjectsVisible(idsToHide, false)` 
   - Till: iterera och satt `entity.pickable = false; entity.opacity = 0; entity.edges = false` (behall `visible = true`)

2. Lagg till ny loop for IfcSpace-entities:
   - Hitta alla metaObjects med `type === 'ifcspace'`
   - Satt `entity.visible = true; entity.pickable = true; entity.opacity = 0.02`
   - Spara originalvarden i `colorizedFor2dRef` for aterställning

3. I `handleViewModeChange('3d')` (aterställning):
   - Aterställ slab-entities: `entity.pickable = true; entity.opacity = originalOpacity; entity.edges = originalEdges`
   - Aterställ IfcSpace-entities till sina originalvarden (vanligtvis `visible = false` om showSpaces ar av)

**Fil: `src/components/viewer/AssetPlusViewer.tsx`**

Ingen andring kravs -- `selectedFmGuidsChangedCallback` och `selectionChangedCallback` fungerar automatiskt nar entities ar pickable.

### Flode

```text
2D aktiveras:
  -> Slabs: visible=true, pickable=false, opacity=0, edges=false
     (osynliga, blockerar inte klick)
  -> IfcSpace: visible=true, pickable=true, opacity=0.02
     (nastan osynliga men klickbara)
  -> Vaggar: colorize=[0.2,0.2,0.2], opacity=1.0, edges=true
     (tydliga, mörka, fyllda)

Anvandare klickar i 2D:
  -> Pick-stralen passerar genom transparenta slabs
  -> Traffar IfcSpace-ytan
  -> Asset+ selectionChangedCallback avfyras
  -> Rum identifieras och kan visas

3D aterställs:
  -> Slabs: aterställ pickable=true, opacity=original, edges=original
  -> IfcSpace: aterställ till showSpaces-status
  -> Vaggar: aterställ colorize, opacity, edges
```

### Filer som andras

| Fil | Andring |
|---|---|
| `src/components/viewer/ViewerToolbar.tsx` | Andra slab-doljning till pickable=false + opacity=0, lagg till IfcSpace-aktivering i 2D |

