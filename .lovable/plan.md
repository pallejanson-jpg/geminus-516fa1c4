

# Analys: Viewer Mobile UX — Problem och Redesign-plan

## Identifierade problem

### 1. Element-överlappning i övre högra hörnet
**MobileUnifiedViewer** (rad 1120-1174 i UnifiedViewer.tsx) renderar en egen header-bar med back-knapp, mode-switcher OCH en insights-knapp. Samtidigt renderar **NativeViewerShell** (rad 559-571) sin **MobileViewerOverlay** med back-knapp, mode-switcher, filter- och settings-knappar — men den skickar `hideMobileOverlay` för att dölja den. Problemet: **VisualizationToolbar** (rad 714-728) renderar sin trigger-knapp (`MoreVertical`-ikonen) som `absolute top-4 right-4 z-20` — denna kolliderar med insights-knappen (`BarChart2`) som sitter i MobileUnifiedViewer:s header z-40. Båda hamnar i övre högra hörnet.

### 2. Dubbla modväxlare
Det finns TVÅ separata mode-switcher-implementationer: en i `MobileViewerOverlay.tsx` (rad 62-102) och en inline i `MobileUnifiedViewer` (rad 1137-1165). Båda renderas beroende på kodväg. Koden har `hideMobileOverlay` men VisualizationToolbar:s trigger-knapp ignorerar detta.

### 3. Våningsväljaren tar för mycket plats
`FloatingFloorSwitcher` på mobil (rad 194-195) renderas som en horisontell rullbar bar med `bottom-[4.5rem]`, `rounded-full`, `bg-black/50`. Med 5+ våningar tar den upp betydande bredd. Dessutom ligger ViewerToolbar på `bottom-4` med `z-30` — dessa konkurrerar om utrymme nedtill.

### 4. 2D-läge fungerar inte
2D-läget förlitar sig på `VIEW_MODE_2D_TOGGLED_EVENT` och `VIEW_MODE_REQUESTED_EVENT` som triggar `handleViewModeChange` i ViewerToolbar (rad 969-977). Men i MobileUnifiedViewer skickas `setViewMode('2d')` direkt utan att vänta på `VIEWER_MODELS_LOADED`. Om modeller inte är redo ignoreras eventet.

### 5. Split 2D/3D hoppar
Split-läget (rad 958-1068) använder manuell touch-drag för divider med `splitRatio` state. Problemet: `SplitPlanView` laddas bara `{viewerReady ? <SplitPlanView> : <Loader>}` — men viewerReady kan togglea (rad 300-322 visar att det baseras på polling av `__assetPlusViewerInstance`). 3D-panelen har `hideToolbar={!showViewerControls}` men toolbar:en fortfarande lyssnar på events och orsakar layout-hopp.

### 6. Filter-meny gör allt segt (rapporterat)
Bekräftat i föregående sprint — debounce implementerad men `applyFilterVisibility` itererar fortfarande alla scene objects synkront.

---

## Förslag: Dedikerad mobil viewer-arkitektur

Istället för att patcha det responsiva systemet, skapa en **renodlad mobil viewer-komponent** som ersätter `MobileUnifiedViewer`. Samma mönster som `MobileInventoryWizard` — en fristående fullskärmsvy som äger hela sitt UI-lager.

### Ny fil: `src/components/viewer/mobile/MobileViewerPage.tsx`

**Layout-struktur:**
```text
┌──────────────────────────┐
│  Header: ← [2D 2D/3D 3D] │  ← Enda header, z-50, safe-area
├──────────────────────────┤
│                          │
│     Canvas / Split       │  ← touch-action: none, flex-1
│                          │
├──────────────────────────┤
│  [Floor pills]           │  ← Kompakt, max 4 synliga, scroll
├──────────────────────────┤
│  ToolBar (slim)          │  ← h-10, safe-area-bottom
└──────────────────────────┘
   Geminus FAB ↗ (fixed bottom-right)
```

### Konkreta ändringar

**A. Ny `MobileViewerPage.tsx`** (ersätter MobileUnifiedViewer-funktionen)
- En enda header-bar med: back-knapp (vänster), mode-switcher (mitten), max 2 knappar höger (filter + settings/insights — INTE båda synliga samtidigt)
- Ingen överlappning — settings-knappen öppnar VisualizationToolbar som Sheet från höger
- Insights öppnas via Geminus-menyn istället för egen knapp i headern

**B. Kompakt våningsväljare**
- Max 3-4 synliga pills + "..." overflow
- Placeras precis ovanför toolbar:en, inte flytande mitt i canvasen
- Höjd: 28px istället för nuvarande 36px

**C. Fix 2D-läge**
- Skicka `VIEW_MODE_REQUESTED_EVENT` OCH `VIEW_MODE_2D_TOGGLED_EVENT` sekventiellt med retry-mekanism (vänta på `VIEWER_MODELS_LOADED` innan dispatch)
- Guard: om `viewerReady === false`, köa mode-bytet och utför det vid ready

**D. Stabil split-vy**
- Fast 50/50 delning som default (ingen drag-handle)
- Enkel knapp för att toggla 40/60 vs 60/40
- SplitPlanView renderas alltid men `visibility: hidden` tills redo (undviker layout-hopp)

**E. Eliminera dubbla overlays**
- Ta bort `MobileViewerOverlay.tsx` helt — all mobil-UI ägs av `MobileViewerPage`
- NativeViewerShell skickar alltid `hideMobileOverlay` + `hideBackButton` på mobil
- VisualizationToolbar:s trigger-knapp döljs på mobil (öppnas via headerns settings-knapp)

**F. Filter-panel performance**
- Flytta `applyFilterVisibility` till en Web Worker eller åtminstone chunka iterationen (100 objekt per frame via `requestIdleCallback`)

### Filer som ändras

| Fil | Ändring |
|---|---|
| `src/components/viewer/mobile/MobileViewerPage.tsx` | **NY** — dedikerad mobil viewer |
| `src/pages/UnifiedViewer.tsx` | MobileUnifiedViewer delegerar till MobileViewerPage |
| `src/components/viewer/NativeViewerShell.tsx` | Alltid `hideMobileOverlay` + `hideBackButton` på mobil |
| `src/components/viewer/FloatingFloorSwitcher.tsx` | Kompaktare pills, max 4 synliga |
| `src/components/viewer/VisualizationToolbar.tsx` | Dölj trigger-knapp på mobil |
| `src/components/viewer/ViewerToolbar.tsx` | Mobilanpassad slim toolbar |
| `src/components/viewer/ViewerFilterPanel.tsx` | requestIdleCallback-chunkning |

### Implementationsordning

1. Skapa `MobileViewerPage.tsx` med ren header + canvas + toolbar-layout
2. Flytta all logik från `MobileUnifiedViewer` dit, ta bort duplikat-overlays
3. Fixa 2D-mode event-sekvensering
4. Kompaktera floor switcher
5. Stabilisera split-vy
6. Filter performance-chunkning

