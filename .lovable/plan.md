

# Plan: Viewer-menyer som sidopaneler + Rumsvisualisering fix

## Sammanfattning

Tva huvudandringar:

1. **Ersatt flytande menyer med en fast hogersidopanel (Sheet/Drawer)** -- Alla viewer-menyer (VisualizationToolbar, RoomVisualizationPanel, ViewerTreePanel, SidePopPanels) konsolideras till en hogermeny som skjuts in/ut via en hamburgare, precis som mobilversionen redan gor (MobileViewerOverlay pattern).

2. **Fix av rumsvisualisering sa den fungerar tillforlitligt** -- Saker automatisk farginladdning vid val av visualiseringstyp, med robust "Visa rum"-aktivering och ratt golvsfiltrering.

---

## Del 1: Hogersidopanel istallet for flytande menyer

### Nuvarande arkitektur (problem)

- **VisualizationToolbar**: Flytande, dragbar panel (position med x/y-koordinater) med SidePopPanel-barn for BIM-modeller, vaningsplan, annotationer
- **RoomVisualizationPanel**: Separat flytande, dragbar panel
- **ViewerTreePanel**: Separat flytande panel (vanter sida)
- **FloatingIssueListPanel**: Ytterligare flytande panel

Allt "flyter runt" med drag-handlers, pixelpositionering, och kan hamna utanfor skarmens kant.

### Ny arkitektur

Ersatt alla flytande paneler med en **en enda hogersidopanel** (Sheet/Drawer) som innehaller allt. Exakt samma monster som `MobileViewerOverlay` redan anvander -- men nu for bade desktop och mobil.

```text
+----------------------------------------------------------+
| [X] [Full] [Tree]                    [Hamburger-knapp] |
|                                                          |
|                                                          |
|                     3D VIEWER                            |
|                                          +-------------+ |
|                                          | Sheet/Drawer | |
|                                          | - BIM models | |
|                                          | - Floors     | |
|                                          | - Display    | |
|                                          |   - 2D/3D    | |
|                                          |   - Visa rum | |
|                                          |   - Annot.   | |
|                                          |   - RumsVis  | |
|                                          | - Settings   | |
|                                          | - Actions    | |
|                                          +-------------+ |
|   [Floor pills]                                          |
|   [Navigation toolbar]                                   |
+----------------------------------------------------------+
```

### Implementationsdetaljer

**Ny komponent: `ViewerRightPanel.tsx`**

Skapar en ny komponent som konsoliderar all funktionalitet fran:
- `VisualizationToolbar.tsx` (innehall, inte panelen)
- `RoomVisualizationPanel.tsx` (inbaddad som sektion)
- Submenyer (BIM-modeller, vaningsplan, annotationer)

Anvander `Sheet` (fran Radix/shadcn) med `side="right"` for en renare UX. Panelen oppnas/stangs med en hamburgerknapp i viewerns header.

Sektioner:
1. **BIM-modeller** (Collapsible)
2. **Vaningsplan** (Collapsible)
3. **Visa** (2D/3D, Visa rum, Annotationer, Rumsvisualisering)
4. **Rumsvisualisering** (inbaddad direkt -- typ-val, legend, statistik)
5. **Viewer settings** (Collapsible -- klipphodj, rumsetiketter, tema, bakgrund)
6. **Atgarder** (Skapa vy, Skapa arende, Visa arenden)

**Andringar i `AssetPlusViewer.tsx`:**
- Ersatt VisualizationToolbar-triggerknappen med en Sheet-trigger
- Flytta RoomVisualizationPanel fran separat flytande komponent till inbaddad i sidopanelen
- Behall ViewerTreePanel som flytande vanstersidopanel (den fungerar redan bra dar)

**Ta bort:**
- All drag-logik fran VisualizationToolbar (mouseDown, mouseMove, position-state)
- SidePopPanel-anrop (BIM, floors, annotations -- dessa blir Collapsible-sektioner istallet)
- RoomVisualizationPanel drag-logik (den baddas in direkt)

### Desktop vs Mobil

- **Desktop**: Sheet med `side="right"`, bredd 320-340px, bakgrunden fortfarande interaktiv
- **Mobil**: Samma Sheet, exakt som MobileViewerOverlay redan gor det -- ingen andring behovs for mobil

---

## Del 2: Rumsvisualisering -- tillforlitlig auto-fargning

### Nuvarande problem

Rumsvisualiseringen "fungerar bara sporadiskt" pa grund av flera samverkande problem:

1. **Timing-problem med entity cache**: `applyVisualization` kors ibland innan `entityIdCache` ar uppbyggd fran metaScene (rad 421-430 i RoomVisualizationPanel). useEffect-beroendet ar `entityIdCache.size` men cachen byggs asynkront.

2. **"Visa rum" maste vara aktivt**: Rumsobjekten (IfcSpace) maste vara synliga i viewern innan de kan fargas. Komponenten skickar `FORCE_SHOW_SPACES_EVENT` pa mount, men det ar inte garanterat att viewern hinner reagera.

3. **Val av typ bor automatiskt tanda rum + farga**: Nar man valjer tex "Temperatur" bor det:
   - Automatiskt aktivera "Visa rum" (IfcSpace-objekt synliga)
   - Automatiskt farga in rummen baserat pa typ
   - Bara visa rum for selekterade vaningsplan

4. **Byte av typ (t.ex. Temp -> CO2) bor direkt farga om**: Koden har redan `applyVisualization` i useEffect (rad 421), men den koers inte alltid tillforlitligt pa grund av race conditions med cachen.

### Losning

**a) Saker auto-aktivering av "Visa rum":**

Nar visualiseringstyp andras fran `none` till nagot:
- Dispatcha `FORCE_SHOW_SPACES_EVENT`
- Vanta en kort tid (200ms) for att ge viewern tid att rendera IfcSpace-objekten
- Sedan kora `applyVisualization`

**b) Saker cache-timing:**

Endra logiken sa att `applyVisualization` har en retry-mekanism:
- Om `entityIdCache.size === 0`, vanta 500ms och forsok igen (max 3 forsok)
- Logga tydligt varfor fargning misslyckades (cache tom, inga rum, etc.)

**c) Garanterad omfargning vid typbyte:**

Nar `visualizationType` andras:
1. Rensa ALLA tidigare farger (resetColors)
2. Om ny typ !== 'none': forcera "Visa rum" + applicera ny fargning

**d) Golvsfiltrering:**

Se till att `visibleFloorFmGuids` alltid skickas korrekt till komponenten. I nuvarande kod (AssetPlusViewer rad 2984):
```typescript
visibleFloorFmGuids={visibleFloorFmGuids.length > 0 ? visibleFloorFmGuids : undefined}
```

Nar `undefined` skickas visas alla rum -- men vi bor sakerstalla att golvsselektionen synkas korrekt vid byte.

### Tekniska andringar i RoomVisualizationPanel

```typescript
// Ny logik for automatisk "Visa rum" + fargning vid typbyte
useEffect(() => {
  if (visualizationType === 'none') {
    resetColors();
    return;
  }
  
  // Steg 1: Tvinga "Visa rum" pa
  window.dispatchEvent(new CustomEvent(FORCE_SHOW_SPACES_EVENT, { detail: { show: true } }));
  if (onShowSpaces) onShowSpaces(true);
  
  // Steg 2: Vanta pa att IfcSpace-objekt blir synliga
  const applyWithRetry = (attempt: number) => {
    if (entityIdCache.size > 0 && rooms.length > 0) {
      applyVisualization();
    } else if (attempt < 3) {
      setTimeout(() => applyWithRetry(attempt + 1), 500);
    } else {
      console.warn('Room visualization: gave up after 3 attempts');
    }
  };
  
  // Kort delay for att ge viewern tid att rendera rum
  setTimeout(() => applyWithRetry(0), 200);
}, [visualizationType, useMockData]);
```

---

## Filer som andras

| Fil | Andring |
|-----|---------|
| **NY: `src/components/viewer/ViewerRightPanel.tsx`** | Ny komponent -- Sheet-baserad hogersidopanel med alla visningstool |
| `src/components/viewer/AssetPlusViewer.tsx` | Ersatt VisualizationToolbar + RoomVisualizationPanel med ViewerRightPanel |
| `src/components/viewer/RoomVisualizationPanel.tsx` | Stod for `embedded` mode (utan drag/header), robust auto-fargning |
| `src/components/viewer/VisualizationToolbar.tsx` | Kan tas bort helt (funktionalitet flyttas till ViewerRightPanel) |
| `src/components/viewer/SidePopPanel.tsx` | Behalls men anvands inte langre fran VisualizationToolbar |

---

## Implementationsordning

| Prio | Steg | Beskrivning |
|------|------|-------------|
| 1 | ViewerRightPanel | Skapa ny komponent med Sheet-baserad hogersidopanel |
| 2 | RoomVisualization fix | Robust auto-fargning med retry och auto-"Visa rum" |
| 3 | AssetPlusViewer integration | Byt ut VisualizationToolbar mot ViewerRightPanel |
| 4 | Cleanup | Ta bort oanvand drag-logik, SidePopPanel-anvandning |

---

## Vad behalls

- **ViewerToolbar** (navigationsverktygsfalt langst ner) -- behalls oforandrad
- **FloatingFloorSwitcher** (pills) -- behalls
- **FloorCarousel** -- behalls
- **MobileViewerOverlay** -- behalls (anvander redan Sheet-monster)
- **ViewerTreePanel** som vansterpanel -- behalls (fungerar bra)

