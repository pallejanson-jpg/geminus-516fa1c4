
# Fix: Annotations fungerar inte -- dual-state-bugg och saknad synkronisering

## Rotorsak

Det finns **tva separata `showAnnotations`-states** som inte ar synkade:

1. **AssetPlusViewer** har `showAnnotations = true` (rad 189) -- detta anvands nar lokala annotation-markor skapas
2. **VisualizationToolbar** har sin egen `showAnnotations = false` (rad 111) -- detta ar vad Switch-kontrollen visar

Nar du togglar "Visa annotationer" i menyn handlar foljande:
- Toolbar uppdaterar sitt eget state och anropar `assetViewer.onToggleAnnotation()` (Asset+ inbyggda annotationer)
- De lokala DOM-markorna (brandslagare, larm etc) paverkas **inte alls**

Resultatet: markorna skapas (koden fungerar), men nar toolbaren sager "av" ar markorna fortfarande synliga -- och nar den sager "pa" forandras ingenting for de lokala markorna.

## Losning

### 1. Ta bort duplikat-state -- anvand props fran AssetPlusViewer

`AssetPlusViewer` skickar redan `showAnnotations` och `onShowAnnotationsChange` som props till `VisualizationToolbar`. Men toolbaren ignorerar dessa och anvander sitt eget lokala state. Andringen ar:

- **VisualizationToolbar**: Ta bort lokalt `showAnnotations`-state. Anvand `externalShowAnnotations` (prop) istallet. Nar man togglar, anropa `onShowAnnotationsChange` (prop-callback) istallet for att uppdatera lokalt state.

- **AssetPlusViewer**: I `handleAnnotationsChange`-callbacken (rad 534-537), uppdatera bade `setShowAnnotations` OCH alla lokala annotation-markorers `display`-stil via `localAnnotationsPluginRef`.

### 2. Synka lokala markor nar showAnnotations andras

Lagg till en `useEffect` i `AssetPlusViewer` som lyssnar pa `showAnnotations`-andringar och uppdaterar alla lokala annotation-markors `display`:

```text
useEffect(() => {
  const plugin = localAnnotationsPluginRef.current;
  if (!plugin?.annotations) return;
  Object.values(plugin.annotations).forEach(ann => {
    ann.markerShown = showAnnotations;
    if (ann.markerElement) {
      ann.markerElement.style.display = showAnnotations ? 'flex' : 'none';
    }
  });
}, [showAnnotations]);
```

### 3. Synka standardvarden

Satt default for `showAnnotations` i AssetPlusViewer till `false` (istallet for `true`) sa att bada komponenter startar fran samma tillstand. Annotationer visas forst nar anvandaren aktivt valjer att visa dem.

## Filer som andras

| Fil | Andring |
|---|---|
| `src/components/viewer/VisualizationToolbar.tsx` | Ta bort lokalt `showAnnotations`-state. Anvand props (`showAnnotations`, `onShowAnnotationsChange`) istallet. |
| `src/components/viewer/AssetPlusViewer.tsx` | Andra default `showAnnotations` till `false`. Lagg till `useEffect` som synkar lokala markor nar state andras. Uppdatera `handleAnnotationsChange` att aven toggla `assetViewer.onToggleAnnotation`. |

## Tekniska detaljer

### VisualizationToolbar -- props-baserat state

Toolbaren tar redan emot props (rad 2941-2942 i AssetPlusViewer):
```text
showAnnotations={showAnnotations}
onShowAnnotationsChange={handleAnnotationsChange}
```

Men i VisualizationToolbar anvands lokalt state (rad 111):
```text
const [showAnnotations, setShowAnnotations] = useState(false);
```

Andringen ar att lasa props istallet:
```text
// Ta bort: const [showAnnotations, setShowAnnotations] = useState(false);
// Anvand: props.showAnnotations (redan tillgangligt som externalShowAnnotations eller liknande)
```

Och nar man togglar:
```text
const handleToggleAnnotations = useCallback(() => {
  const newValue = !showAnnotations;  // fran prop
  onShowAnnotationsChange?.(newValue);  // meddela AssetPlusViewer
  // Asset+ inbyggda annotationer
  viewerRef.current?.assetViewer?.onToggleAnnotation?.(newValue);
}, [viewerRef, showAnnotations, onShowAnnotationsChange]);
```

### AssetPlusViewer -- synka lokala markor

```text
const handleAnnotationsChange = useCallback((show: boolean) => {
  setShowAnnotations(show);
  // Uppdatera lokala annotation-markor
  const plugin = localAnnotationsPluginRef.current;
  if (plugin?.annotations) {
    Object.values(plugin.annotations).forEach((ann: any) => {
      ann.markerShown = show;
      if (ann.markerElement) {
        ann.markerElement.style.display = show ? 'flex' : 'none';
      }
    });
  }
  // Asset+ inbyggda annotationer
  try {
    viewerRef.current?.assetViewer?.onToggleAnnotation?.(show);
  } catch (e) {}
}, []);
```

## Sammanfattning

Problemet ar inte att data saknas eller att symboler inte laddas -- din inventerade brandslagare med symbol AR dar. Problemet ar att toolbarens toggle-knapp styr en **annan** `showAnnotations` an den som markorna anvander. Fixens karna ar att ta bort duplikat-statet och lata AssetPlusViewer vara "single source of truth" for annotation-synlighet.
