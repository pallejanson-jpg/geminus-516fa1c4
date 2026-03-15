

# Visualiseringsindikatorer i Viewern — Nuläge & Förbättringsförslag

## Var finns de idag?

Indikatorerna finns och fungerar, men de är **gömda djupt i UI-hierarkin**:

1. **Aktivering**: Öppna höger-panelen (Sheet) → Expandera "Rumsvisualisering" → Välj typ i dropdown → Slå på mock-data om ingen riktig sensor finns
2. **Legend-bar**: `VisualizationLegendOverlay` renderas som en vertikal gradient-bar på **vänster kant** av canvas — men bara när en visualisering är aktiv
3. **Hover-label**: `IoTHoverLabel` visar värde vid mus-hover över rum

**Problem**: Det krävs 3-4 klick för att aktivera, och legend-baren är diskret/lätt att missa.

## Förbättringsförslag

### 1. Snabbväljare direkt på toolbaren (Quick Viz Chips)
Istället för att gräva i höger-panelen, lägg till en rad med små pill-knappar direkt ovanför eller under botten-toolbaren:

```text
┌─────────────────────────────────┐
│         3D CANVAS               │
│                                 │
│  ┌──┐                          │
│  │▓▓│ 30°C                     │  ← Legend-bar (redan finns)
│  │▓▓│ 24°C                     │
│  │▓▓│ 18°C                     │
│  └──┘                          │
│                                 │
│  [🌡️][💨][💧][👥][📐]          │  ← NYA snabbknappar
│  [Orbit][Pan][Fit][Sel][⚙️]    │  ← Toolbar
└─────────────────────────────────┘
```

- En rad med 5 ikoner (temp, CO₂, fukt, beläggning, yta)
- Tappa = aktivera/avaktivera direkt — ingen dropdown
- Aktiv knapp markeras med sin färg (grön/röd gradient)
- Samma rad på desktop och mobil

### 2. Förbättrad legend-bar
- **Större och tydligare** — öka bredd från 14-18px till 24px
- **Rubrik** högst upp: "🌡️ Temperatur (°C)" med vit text
- **Aktuellt medel** som en markör/pil på gradient-baren
- **Bättre kontrast** — lägg till halvtransparent mörk bakgrund bakom hela legend-komponenten

### 3. Auto-aktivering vid insikts-navigation
När användaren navigerar från Insights → Viewer med en specifik visualisering (t.ex. "visa temperatur"), aktiveras visualiseringen automatiskt (detta stöds redan delvis via `INITIAL_VISUALIZATION_REQUESTED` event).

## Filer att ändra

| Fil | Ändring |
|-----|--------|
| `src/components/viewer/VisualizationQuickBar.tsx` | **Ny** — rad med pill-knappar för snabb typ-växling |
| `src/components/viewer/VisualizationLegendBar.tsx` | Förstora, lägg till rubrik, mörk bakgrund, medelmarkör |
| `src/components/viewer/AssetPlusViewer.tsx` | Rendera `VisualizationQuickBar` ovanför toolbaren |
| `src/components/viewer/mobile/MobileViewerPage.tsx` | Rendera quick-bar i mobilt läge |

