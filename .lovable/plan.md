
# Plan: Kartförbättringar - Popup-styling, Sökning och Ikoninfärgning

## Översikt

Denna plan omfattar tre förbättringar av kartfunktionaliteten:
1. **Svart bakgrund i popup** - Tydligare läsbarhet för byggnadsinformation
2. **Sökfunktion i byggnadsväljaren** - Snabbare navigering bland många byggnader
3. **Infärgningsmeny för ikoner** - Visualisera byggnader baserat på prestanda-metrics

---

## Del 1: Svart bakgrund i byggnadspopupen

Popupen som visas när man klickar på en byggnad har idag transparent bakgrund vilket gör texten svår att läsa mot kartunderlaget.

### Ändringar

**Fil: `src/components/map/MapView.tsx`** (rad 413)

Ändra Card-komponenten i popupen:
```tsx
// Före
<Card className="border-0 shadow-none bg-transparent">

// Efter
<Card className="border-0 shadow-xl bg-black/95 backdrop-blur-sm">
```

**Fil: `src/index.css`** (rad 189-194)

Uppdatera popup-bakgrund:
```css
.mapboxgl-popup-content {
  background: rgb(0 0 0 / 0.95) !important;
  padding: 0 !important;
  border-radius: 0.5rem !important;
  box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.5) !important;
}
```

---

## Del 2: Sökfunktion i byggnadsväljaren

Byggnadsväljaren i vänster kant av kartan listar alla byggnader. För portföljer med många byggnader behövs en sökfunktion.

### UI-skiss

```text
+------------------------------------------+
| 🏢 Buildings (12)                        |
+------------------------------------------+
| [🔍 Search buildings...              ]   |
+------------------------------------------+
| Byggnad 01                               |
| Industrivägen 1                          |
+------------------------------------------+
| Byggnad 02                               |
| Storgatan 15                             |
+------------------------------------------+
```

### Ändringar

**Fil: `src/components/map/MapView.tsx`**

Lägg till sökfält i `BuildingSidebar`-komponenten:
- Importera `Input` och `Search`-ikonen
- Lägg till state för `searchQuery`
- Filtrera `facilities` baserat på namn och adress
- Visa sökfält mellan header och listan

---

## Del 3: Infärgningsverktyg för kartikoner

En ny dropdown-meny uppe till höger på kartan som låter användaren färglägga byggnadsikonerna baserat på olika metrics.

### UI-skiss

```text
+-------------------------------------------+
| 📊 Color markers by...            [⚙️]   |
+-------------------------------------------+
| ○ Default (no coloring)                   |
| ● Energy efficiency (kWh/m²)              |
| ○ Work orders (count)                     |
| ○ CO₂ emissions                           |
| ○ Energy rating (A-E)                     |
+-------------------------------------------+
| 🟢 A/B  🟡 C  🟠 D  🔴 E     [Legend]     |
+-------------------------------------------+
```

### Infärgningstabeller (baserade på Insights-mockup)

**Energy efficiency (kWh/m²)**:
| Värde | Färg |
|-------|------|
| < 90 | Grön |
| 90-100 | Ljusgrön |
| 100-120 | Gul |
| 120-140 | Orange |
| > 140 | Röd |

**Work orders (mock)**:
| Antal | Färg |
|-------|------|
| 0-2 | Grön |
| 3-5 | Gul |
| 6-10 | Orange |
| > 10 | Röd |

**CO₂ emissions (tons)**:
Beräknas som `area * 0.012`. Använder samma färgskala som kWh/m².

**Energy Rating**:
| Rating | Färg |
|--------|------|
| A | Mörkgrön |
| B | Grön |
| C | Gul |
| D | Orange |
| E | Röd |

### Nya komponenter/funktioner

**Ny fil: `src/lib/map-coloring-utils.ts`**

```typescript
export type MapColoringMode = 
  | 'none' 
  | 'energy-efficiency' 
  | 'work-orders' 
  | 'co2' 
  | 'energy-rating';

export interface BuildingMetrics {
  fmGuid: string;
  energyPerSqm: number;
  workOrders: number;
  co2Tons: number;
  energyRating: 'A' | 'B' | 'C' | 'D' | 'E';
}

export function getBuildingColor(
  metrics: BuildingMetrics, 
  mode: MapColoringMode
): string {
  // Returns hex color based on mode and metric values
}

export function generateMockBuildingMetrics(
  fmGuid: string,
  area: number
): BuildingMetrics {
  // Deterministic mock data based on fmGuid hash
  // Uses same logic as PerformanceTab
}
```

### Ändringar i MapView.tsx

1. **Ny state** för färgläge:
```typescript
const [coloringMode, setColoringMode] = useState<MapColoringMode>('none');
```

2. **Beräkna metrics** för alla byggnader i `mapFacilities`:
```typescript
const buildingMetrics = useMemo(() => {
  return mapFacilities.map(f => ({
    fmGuid: f.fmGuid,
    ...generateMockBuildingMetrics(f.fmGuid, f.area || 0)
  }));
}, [mapFacilities]);
```

3. **Ny dropdown-meny** i verktygspanelen (bredvid lager-knappen):
- Dropdown med ikoner för varje alternativ
- Visa förklaring/legend när färgläge är aktivt

4. **Uppdatera SingleMarker** för att ta emot färg:
```tsx
<SingleMarker
  ...
  color={coloringMode !== 'none' 
    ? getBuildingColor(metrics, coloringMode) 
    : undefined
  }
/>
```

5. **Uppdatera MapCluster.tsx**:
- Lägg till optional `color`-prop på `SingleMarker`
- Använd färgen för markörsymbolen

---

## Filer som skapas/ändras

| Fil | Typ | Beskrivning |
|-----|-----|-------------|
| `src/components/map/MapView.tsx` | Ändra | Popup-styling, sökfält, färgmeny |
| `src/components/map/MapCluster.tsx` | Ändra | Stöd för dynamisk färg på markörer |
| `src/index.css` | Ändra | Popup-bakgrundsfärg |
| `src/lib/map-coloring-utils.ts` | **NY** | Hjälpfunktioner för färgberäkning |

---

## Tekniska detaljer

### Färginterpolering
Samma logik som används i `src/lib/visualization-utils.ts` för rumsvisualisering kan återanvändas för kartmarkörer.

### Deterministisk mockdata
Använder `fmGuid.split('').reduce((a, c) => a + c.charCodeAt(0), 0)` för att generera konsekventa värden per byggnad (samma approach som PerformanceTab).

### Tillgänglighet
- Legend visas alltid när färgläge är aktivt
- Använder färger som även fungerar för färgblinda (skillnad i ljushet)
- Tooltip på marker visar exakt värde

---

## Implementeringsordning

1. **Popup-styling** - Snabb CSS-ändring
2. **Sökfunktion** - Lägg till i BuildingSidebar
3. **map-coloring-utils.ts** - Skapa hjälpbibliotek
4. **MapCluster.tsx** - Lägg till färgstöd
5. **MapView.tsx** - Integrera färgväljare och meny
