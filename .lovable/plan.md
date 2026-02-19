
# Uppdaterad plan: Senslinc-integration + Unified 3D+Analytics + Karta på startsidan

## Förtydligande: Insights-panelen är byggnadsscoppad

Som du korrekt påpekar: 3D-viewern laddar alltid EN byggnad åt gången (via `?building=<fmGuid>` i URL). Insights-panelen ska följa exakt samma scope – den visar data för den specifika byggnaden, inte portfolion.

Tekniskt sett har vi redan allt vi behöver:
- `UnifiedViewer` har `buildingFmGuid` från URL-parametern
- `BuildingInsightsView` tar `facility: Facility` som prop
- Vi kan slå upp `facility` ur `AppContext.allData` med hjälp av `buildingFmGuid`

Panelen renderar alltså `<BuildingInsightsView facility={currentBuilding} />` – men i en collapsible bottom-sheet inuti viewern, istället för som en separat sida.

---

## Del 1 – InsightsDrawerPanel i UnifiedViewer (byggnadsscoppad)

### Flödet
Oavsett hur man öppnar 3D-viewern (Portfolio → 3D, Navigator → 3D, Insights → fullscreen) är `?building=<guid>` alltid med i URL. Panelen läser den och visar Insights för exakt den byggnaden.

```
URL: /split-viewer?building=<fmGuid>&mode=3d

UnifiedViewerContent
  ├── AssetPlusViewer (3D-canvasen)
  └── InsightsDrawerPanel
        ├── slår upp facility från allData via buildingFmGuid
        └── renderar BuildingInsightsView(facility) i collapsible sheet
              ├── Performance
              ├── Space  
              ├── Asset
              └── Sensorer (med RoomSensorDetailSheet)
```

### Ny komponent: `InsightsDrawerPanel`
Placeras i `src/components/viewer/InsightsDrawerPanel.tsx`.

- Läser `buildingFmGuid` som prop (passas från `UnifiedViewerContent`)
- Slår upp `facility` via `useContext(AppContext).allData`
- Renderar en **collapsible bottom bar**:
  - Stängd: smal balk (~48px) med `📊 Insights – [Byggnadens namn]` + en chevron-upp-knapp
  - Öppen: panelen glider upp till ~300px med en scrollbar tab-vy
- Innehåller tabbar: **Performance | Space | Asset | Sensorer**
- Varje tabb återanvänder befintliga chart-komponenter från `BuildingInsightsView`
- `handleInsightsClick` delegeras upp till `UnifiedViewerContent` som redan hanterar 3D-färgläggning via `sessionStorage` + navigation

### Layout i UnifiedViewer
```
┌──────────────────────────────────────────────┐
│  [←] [3D][360][VT][Split]  [📊 Insights ▲]  │  ← toggle-knapp i befintlig toolbar
├──────────────────────────────────────────────┤
│                                              │
│         AssetPlusViewer                      │
│         (flex-1, krymper när panel öppnas)   │
│                                              │
├──────────────────────────────────────────────┤ ← drag-handle (resize)
│  Performance | Space | Asset | Sensorer      │  ← 300px collapsible
│  [BarChart]  [PieChart]  [SensorGrid]        │
└──────────────────────────────────────────────┘
```

- Toggle-knappen läggs till i den befintliga ModeButton-raden i `UnifiedViewerContent`
- Panelen är dold på mobile (samma mönster som andra desktop-only features)
- Panelen startar stängd – användaren öppnar manuellt

### Entrypoint-harmoni
| Entrypoint | Vad händer |
|---|---|
| Portfolio → 3D | `/split-viewer?building=X&mode=3d` → panel tillgänglig, stängd initialt |
| Navigator → 3D | Samma URL-mönster → panel tillgänglig |
| Insights → fullscreen inline-viewer | Navigerar till `/split-viewer?building=X&mode=3d&insightsMode=Y` → panel öppnar automatiskt och aktiverar rätt tabb |
| QuickActions → IoT+ | Öppnar panel och hoppar till Sensorer-tabben |

---

## Del 2 – Karta på startsidan (HomeMapPanel)

### Layout på desktop
```
HomeLanding (xl:flex-row)
┌───────────────────────────────┬────────────────────────────────┐
│  AI Assistants                │                                │
│  [Gunnar] [Ilean] [Doris]     │   HomeMapPanel                 │
│                               │   (Cesium-glob primär)         │
│  My Favorites                 │                                │
│  [Bld1] [Bld2] [Bld3]        │  ┌─────────────────────────┐   │
│                               │  │  🌍 Cesium  🗺 Mapbox   │   │  ← toggle
└───────────────────────────────┴──┴─────────────────────────┴───┘
```

- Ny komponent `src/components/home/HomeMapPanel.tsx`
- State: `mapMode: 'cesium' | 'mapbox'`
- Cesium-glob: lazy-loadar `CesiumGlobeView` och flyger in till byggnadernas koordinater
- Mapbox: renderar befintlig `MapView` med kluster
- Toggle: liten knapp-par i övre hörnet av kartan
- Klick på karta → navigerar till `map` eller `globe` i appens sidomenyer
- På `<xl:` → kartan döljs (mobil ändras inte)

### Ändring i HomeLanding
- Layout: `max-w-4xl mx-auto` → `max-w-none xl:flex xl:gap-6 xl:px-8`
- Vänsterkolumn: `xl:w-[560px] shrink-0`
- Högerkolumn: `xl:flex-1 xl:min-h-[500px]`

---

## Del 3 – Desktop-layout generellt

Ingår som sidoeffekt av Del 2 (bredare layout på startsidan). Byggnadssidan (`FacilityLandingPage`) lämnas tills vidare – den är inte lika tom eftersom den redan har inline-3D-viewern på desktop.

---

## Filer som ändras/skapas

| Fil | Vad |
|---|---|
| `src/components/viewer/InsightsDrawerPanel.tsx` | NY – byggnadsscoppad bottom-sheet med Insights-tabbar |
| `src/pages/UnifiedViewer.tsx` | Lägg till toggle-knapp + montera `InsightsDrawerPanel` |
| `src/components/home/HomeMapPanel.tsx` | NY – Cesium/Mapbox-växlare |
| `src/components/home/HomeLanding.tsx` | Desktop-layout + montera `HomeMapPanel` |

BuildingInsightsView.tsx behöver INTE refaktoreras – `InsightsDrawerPanel` renderar den direkt som en child (med `onBack` som no-op). Grafer återanvänds automatiskt.

---

## Tekniska detaljer

### InsightsDrawerPanel – scope-lösning
```tsx
// I InsightsDrawerPanel.tsx
const { allData } = useContext(AppContext);

const facility = useMemo(() => {
  // Slå upp byggnaden från allData via buildingFmGuid
  for (const portfolio of allData) {
    const match = portfolio.facilities?.find(f => f.fmGuid === buildingFmGuid);
    if (match) return match;
  }
  return null;
}, [allData, buildingFmGuid]);

if (!facility) return null; // Visar ingenting om byggnaden inte hittas
```

### Toggle-knapp i UnifiedViewer toolbar
```tsx
// Läggs till i modeButton-raden
<ModeButton
  mode="insights" // Ny pseudo-mode, styr bara panelen
  icon={BarChart2}
  label="Insights"
  active={insightsPanelOpen}
  onClick={() => setInsightsPanelOpen(!insightsPanelOpen)}
/>
```

### Auto-öppna från Insights-entrypoint
Om `?insightsMode=` finns i URL → `InsightsDrawerPanel` startar öppen och hoppar till rätt tabb. Detta harmoniserar flödet från `BuildingInsightsView` inline → fullscreen 3D med analytics.

---

## Vad implementeras INTE i detta steg
- Refaktorering av graf-komponenter (onödig komplexitet, panelen renderar `BuildingInsightsView` direkt)
- IoT+-knapp som öppnar panelen direkt (kan läggas till i steg 2 om det fungerar bra)
- Resize/drag-handle för panelen (kan läggas till i steg 2)
- Ändringar på mobil (oförändrat)
