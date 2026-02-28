

# Plan: Native Viewer Komplett Mobil-UI

## Kärnproblem
`NativeViewerPage` renderar bara `NativeXeokitViewer` (en ren canvas). Alla UI-overlays (VisualizationToolbar, FloatingFloorSwitcher, ViewerFilterPanel, MobileViewerOverlay, ViewerContextMenu, dialoger) är enbart kopplade till den gamla `UnifiedViewer`/`AssetPlusViewer`-flödet. Därför saknas all interaktion på mobil och desktop.

## Implementationsplan

### Steg 1: Bygg ut `NativeViewerPage` med komplett viewer-shell

Skapa en ny wrapper-komponent `NativeViewerShell` som omsluter `NativeXeokitViewer` och monterar alla UI-overlays:

**Fil:** `src/components/viewer/NativeViewerShell.tsx` (ny fil)

Komponenten ska:
- Ta emot `buildingFmGuid` och `onClose`
- Hålla state för: `isViewerReady`, `showFilterPanel`, `showSettings` (VisualizationToolbar), `viewMode` (2d/3d)
- Rendera i lager:
  1. `NativeXeokitViewer` (canvas, ref sparas)
  2. `MobileViewerOverlay` (mobil: bakåtknapp + filter/settings-knappar)
  3. `VisualizationToolbar` (desktop + mobil meny)
  4. `FloatingFloorSwitcher` (våningspills)
  5. `ViewerFilterPanel` (filterpanel vid klick)
  6. `ViewerContextMenu` (högerklick)
- Lyssna på `NativeXeokitViewer`s `phase === 'ready'` event för att sätta `isViewerReady`

### Steg 2: Refaktorera `NativeXeokitViewer` att exponera viewerRef

**Fil:** `src/components/viewer/NativeXeokitViewer.tsx`

- Exponera `viewerRef.current` (xeokit Viewer-instansen) till föräldrakomponenten via `React.forwardRef` eller en callback-prop `onViewerReady(viewer)`
- Dispatcha en custom event `NATIVE_VIEWER_READY` med viewer-referensen när `phase === 'ready'`
- Exponera `buildingFmGuid` som `data-building-guid` på wrapper-diven

### Steg 3: Anpassa `viewerRef`-formatet för overlays

Alla overlays (VisualizationToolbar, FloatingFloorSwitcher, ViewerFilterPanel) förväntar sig `viewerRef.current.$refs.AssetViewer.$refs.assetView.viewer` — den gamla Asset+ kedjan.

**Fix:** Skapa en adapter-ref som matchar det förväntade formatet:
```typescript
const viewerShimRef = useRef({
  $refs: { AssetViewer: { $refs: { assetView: { viewer: xeokitViewerInstance } } } }
});
```
Detta gör att alla befintliga hooks (`useFloorData`, `useModelData`, `useSectionPlaneClipping`) fungerar utan ändringar.

### Steg 4: Högerklickmeny för native viewer

**Fil:** `src/components/viewer/NativeViewerShell.tsx`

- Lägg till `contextmenu`-eventlyssnare på canvasen
- Vid högerklick: använd xeokit `scene.pick()` för att identifiera entitet
- Rendera `ViewerContextMenu` med korrekt position och entity-info
- Koppla actions: properties, zoom-to-fit, isolate, hide

### Steg 5: Uppdatera `NativeViewerPage` att använda shell

**Fil:** `src/pages/NativeViewerPage.tsx`

Byt `<NativeXeokitViewer>` mot `<NativeViewerShell>`.

### Steg 6: Mobil-specifika fixes

- `MobileViewerOverlay`: bakåtknapp → `onClose` → `setActiveApp('portfolio')`  
- `FloatingFloorSwitcher`: redan fixad med `bottom-20` + `flex-row` på mobil
- Säkerställ `MobileNav` FAB-knappen inte krockar med viewer-overlays (dölj FAB när native_viewer är aktiv)

**Fil:** `src/components/layout/MobileNav.tsx`
- Dölj MobileNav FAB-pill när `activeApp` är en viewer-app

### Steg 7: Dialog-responsivitet

`CreateIssueDialog` och `CreateViewDialog`:
- På mobil: rendera som bottom-sheet (full bredd, `bottom: 0`) istället för draggable panel
- Säkerställ `overflow-y-auto` på form-content
- Backdrop för stängning vid klick utanför

---

## Filer att skapa
1. `src/components/viewer/NativeViewerShell.tsx` — ny wrapper med alla overlays

## Filer att ändra  
1. `src/components/viewer/NativeXeokitViewer.tsx` — exponera viewer via callback
2. `src/pages/NativeViewerPage.tsx` — byt till NativeViewerShell
3. `src/components/layout/MobileNav.tsx` — dölj FAB i viewer-läge
4. `src/components/viewer/CreateIssueDialog.tsx` — mobil bottom-sheet + responsivitet
5. `src/components/viewer/CreateViewDialog.tsx` — mobil responsivitet

