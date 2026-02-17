
# Verktygsfältet (ViewerToolbar) — omskrivning från grunden

## Namngivning

För framtida referens:
- **Verktygsfältet** = `ViewerToolbar` — den nedre flytande raden med nav/interaktionsverktyg (det du vill ha omgjord)
- **Visningsmenyn** = `ViewerRightPanel` / `VisualizationToolbar` — höger sida med våningar, modeller, xray etc.
- **Navigatorn** = `ViewerTreePanel` — trädvyn med IFC-hierarki

---

## Nuläge och problem

`ViewerToolbar.tsx` är 946 rader med:

- Komplex `ToolbarSettings`-integration (DnD-sorteringslogik för overflow/visible per verktyg — 328 rader i `ToolbarSettings.tsx`)
- Separata desktop- och mobilrendering med duplicerad logik
- `settingsKey`-force-rerender-hack
- Overflow-meny som innehåller verktyg som redan finns på direktnivå
- `flashOnSelect` och `hoverHighlight` blandas in med navigationsverktyg
- Komponent definieras inuti komponenten (`ToolButton` definieras inne i render-loopen → React-varning)

Dessutom:
- `VisualizationToolbar` (visningsmenyn) innehåller redan 2D/3D-toggle — men den finns **också** i `ViewerToolbar` (duplicerad!)
- `flashOnSelect` och `hoverHighlight` hör hemma i Visningsmenyn, inte i navigationsverktygsfältet
- `ToolbarSettings`-dialogen med DnD-sortering är överkonstruerad för ett verktygsfält med ~8 knappar

---

## Ny design

### Vad behålls (kärn-navigationsfunktioner)

```text
[Orbit] [Förstaperson] | [Zooma in] [Zooma ut] [Anpassa vy] | [Välj] [Mät] [Snitt] | [2D/3D]
```

Alla 8 knappar alltid synliga — inget overflow, ingen anpassning, ingen DnD.

### Vad tas bort från ViewerToolbar

| Tas bort | Varför |
|---|---|
| `ToolbarSettings` DnD-dialog | Överkonstruerat. Ersätts ingenting |
| Overflow-meny | Alla viktiga verktyg ryms på en rad |
| `flashOnSelect` / `hoverHighlight` | Hör hemma i Visningsmenyn |
| Dubblerad 2D/3D-toggle (behålls i Visningsmenyn) | En toggle räcker |
| Collapse/expand-knapp ("Dölj verktygsfält") | Onödig komplexitet |
| `settingsKey` force-rerender | Tas bort med ToolbarSettings |
| `isExpanded` state | Tas bort med collapse-feature |

### Vad tillkommer

- Tydlig responsiv layout: desktop = horisontell pill, mobil = kompaktare pill
- `ToolButton` definieras utanför render-loopen (undviker React-varning)
- Sektioner separeras med `Separator`: Nav | Zoom | Interaktion | Vy
- Renare tooltip-hantering
- Loading-state (disabled när viewer inte är redo) bibehålls

---

## Tekniska filändringar

### `src/components/viewer/ViewerToolbar.tsx` — **skriv om från grunden**

Ny komponent ~200 rader:

```typescript
interface ViewerToolbarProps {
  viewerRef: React.MutableRefObject<any>;
  flashOnSelectEnabled?: boolean;   // Kept for event compat only
  onToggleFlashOnSelect?: (v: boolean) => void;
  hoverHighlightEnabled?: boolean;
  onToggleHoverHighlight?: (v: boolean) => void;
  className?: string;
  disableSelectTool?: boolean;
}
```

Verktygsgrupper:
1. **Navigation**: Orbit, Första person
2. **Zoom/Vy**: Zooma in, Zooma ut, Anpassa vy
3. **Interaktion**: Välj objekt, Mätverktyg, Snittplan
4. **Vyläge**: 2D/3D-toggle

All section-plane-klippningslogik (FLOOR_SELECTION_CHANGED_EVENT, VIEW_MODE_CHANGED_EVENT etc.) **behålls** — det är affärslogik, inte UI-komplexitet.

### `src/components/viewer/ToolbarSettings.tsx` — ta bort DnD-dialogen

`ToolbarSettings` som Dialog med drag-and-drop tas bort. Filen behåller bara:
- `ToolConfig` interface (används fortfarande av `VisualizationToolbar`)
- `getNavigationToolSettings()` / `getVisualizationToolSettings()` (export för kompatibilitet)
- `TOOLBAR_SETTINGS_CHANGED_EVENT` constant

NAVIGATION_TOOLS-listan förenklas — alla tools alltid synliga, inget `inOverflow`.

### `src/components/viewer/AssetPlusViewer.tsx`

- Ta bort `toolbarSettingsOpen`-state och `setToolbarSettingsOpen`-anrop
- Ta bort `onOpenSettings`-prop till `ViewerToolbar` (det öppnade ToolbarSettings-dialogen)
- Behåll `flashOnSelectEnabled` och `hoverHighlightEnabled` props (de används av ForceShowSpaces-eventlyssnare)

---

## Vad löser detta

| Problem | Lösning |
|---|---|
| 946 rader komplex kod | Ny komponent ~200 rader |
| DnD toolbar-customization ingen använder | Tas bort |
| ToolButton definierad i render-loop | Definieras utanför |
| Overflow-meny med duplicerade verktyg | Alla knappar direkt synliga |
| flashOnSelect i navigationsverktyget | Kvar i Visningsmenyn (ViewerRightPanel) |
| Fungerar dåligt på mobil | Renare responsiv layout |
| `settingsKey` force-rerender hack | Borttagen |
