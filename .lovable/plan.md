

## Kombinerad implementation: Insights-till-3D fixes + Desktop inline viewer

Denna plan kombinerar de tva godkanda planerna:
1. Fix av timing/synlighet (bara rum visas, spacesCacheReady)
2. Desktop inline 3D-panel med reaktiv farguppdatering

---

### Del 1: Fix timing och synlighet i AssetPlusViewer

**Fil: `src/components/viewer/AssetPlusViewer.tsx`**

**1a. Lagg till `spacesCacheReady` state**
- Nytt state: `const [spacesCacheReady, setSpacesCacheReady] = useState(false);`
- I cache-effekten (rad 496-525): lagg till `setSpacesCacheReady(true)` efter att cachen byggts (rad 524)

**1b. Uppdatera insights-effekten (rad 267-392)**
- Byt beroende fran `modelLoadState` till `spacesCacheReady` 
- Andring av synlighetslogik: istallet for att bara satta xrayed pa allt, gor sa har:
  1. Satt ALLA objekt till `visible = false`
  2. For matchande rum/objekt: satt `visible = true`, `xrayed = false`, `colorize = rgb`
  3. Ta bort `insightsAppliedRef`-sparren sa att effekten kan koras om nar props andras (behovs for desktop inline-viewern)

**1c. Lagg till hantering av `room_types` och `room_type` modes**
- Iterera genom IfcSpace-metaobjekt, matcha rumstyp mot colorMap-nycklar
- Farglagg matchande rum

**1d. Ny prop `insightsColorMap`**
- `insightsColorMap?: Record<string, [number, number, number]>` -- direkt fargkarta som prop (for desktop inline-viewern, undviker sessionStorage)
- Om denna prop finns, anvand den istallet for sessionStorage

---

### Del 2: Uppdatera Room Types och Energy Distribution i BuildingInsightsView

**Fil: `src/components/insights/BuildingInsightsView.tsx`**

**2a. Room Types pie chart (rad 411-439)**
- Byt fran `navigateTo3D({ visualization: 'area' })` till `navigateToInsights3D` med mode `room_types`
- Lagg till `onClick` pa varje `<Cell>` for enskild rumstyp med mode `room_type`

**2b. Energy Distribution pie chart (rad 352-377)**
- Lagg till `<ViewerLink />` i headern
- Klick pa hela kortet eller "Visa" navigerar med `energy_floors`-lage (alla vaningars farg)

---

### Del 3: Desktop inline 3D-panel

**Fil: `src/components/insights/BuildingInsightsView.tsx`**

**3a. Ny komponent `InsightsInlineViewer`**
- Renderas bara pa desktop (`!isMobile`)
- Innehaller en `AssetPlusViewer` med:
  - `suppressOverlay={true}`
  - `insightsColorMode` och `insightsColorMap` som reaktiva props
  - Fixerad hojd (~500px), sticky position
- Klickbar overlay med `Maximize2`-ikon som oppnar fullskarms-3D (kallar `navigateToInsights3D`)

**3b. Layout-andring**
- Wrappa Tabs-sektionen (rad 291-486) i ett flexbox-grid:
  ```
  <div className="flex gap-4">
    <div className="flex-1 min-w-0">{/* Tabs */}</div>
    {!isMobile && <InsightsInlineViewer ... />}
  </div>
  ```

**3c. Nytt lokalt state for desktop-synkronisering**
- `inlineInsightsMode` och `inlineColorMap` state-variabler
- Vid klick pa diagram (desktop): uppdatera state istallet for att navigera bort
- Vid klick pa diagram (mobil): behall befintligt beteende (navigate)

**3d. Dual-path logik i diagram-klick**
- Alla klickhanterare kontrollerar `isMobile`:
  - **Desktop**: `setInlineInsightsMode(mode)` + `setInlineColorMap(colorMap)`
  - **Mobil**: `navigateToInsights3D(...)` (befintligt beteende)

---

### Del 4: Smafix

**Fil: `src/lib/visualization-utils.ts`**
- Ingen andring behover goras -- `hslStringToRgbFloat` finns redan

---

### Sammanfattning av filandringar

| Fil | Andring |
|-----|---------|
| `AssetPlusViewer.tsx` | `spacesCacheReady` state, dol icke-rum, `room_types`/`room_type` mode, ny prop `insightsColorMap`, ta bort `insightsAppliedRef` |
| `BuildingInsightsView.tsx` | Inline 3D-panel (desktop), dual-path klick (desktop/mobil), Room Types + Energy Distribution klickhantering |

### Resultat
- Rum fargas korrekt (timing fixad via spacesCacheReady)
- Bara rum visas (inga vaggar/dorrar)
- Desktop: inline 3D-panel uppdateras reaktivt vid klick pa diagram
- Desktop: klick pa 3D-panelen oppnar fullskarms-vy
- Mobil: befintligt navigationsbeteende behalles
- Alla diagram (stapel + 3 pie charts) har "Visa"-knappar och klickbara segment

