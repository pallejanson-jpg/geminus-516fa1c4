
# Senslinc Integration – Full Implementation Plan

## Sammandrag av nuläget

Senslinc-login fungerar. Edge function har fullständig auth (Django JWT). Koden för `get-dashboard-url` finns redan och fungerar – den söker machine/site/line via FM GUID och returnerar rätt URL. IOT+-knappen i `PortfolioView` anropar redan `get-dashboard-url` och öppnar iframe via `openSenslincDashboard`. Det är alltså egentligen en ganska mogen grund.

Tre delar ska byggas, i prioritetsordning:

---

## Del 1: IOT+-knappen – Korrekt iframe per entitet

### Nuläget
`buildDashboardUrl` i edge-funktionen bygger URL:en som `{portalUrl}/dashboard/machine/{pk}` – det stämmer förmodligen inte med Senslincs faktiska URL-format.

Live-test bekräftade att Senslinc-maskiner har ett `dashboard_url`-fält direkt på API-objektet (`machine.dashboard_url`). Koden försöker redan läsa det: `machine.dashboard_url || buildDashboardUrl(...)` – men fallback-URL:en kan vara fel.

### Fix (liten men viktig)
Uppdatera `buildDashboardUrl` i `supabase/functions/senslinc-query/index.ts` till att använda korrekt Senslinc URL-format:

```typescript
// Korrekt format baserat på Senslinc portal-struktur:
function buildDashboardUrl(apiUrl: string, type: 'machine' | 'site' | 'line', pk: number): string {
  // Ta bort api. prefix och /api suffix för att få portal-URL
  const portalUrl = apiUrl
    .replace(/^https?:\/\/api\./, 'https://')
    .replace(/\/api\/?$/, '');
  
  const pathMap = {
    machine: `/machine/${pk}/room_analysis/`,
    site:    `/site/${pk}/home/`,
    line:    `/line/${pk}/`,
  };
  return `${portalUrl}${pathMap[type]}`;
}
```

### SenslincDashboardView – tabs: iframe + native data
Komponenten ska ha två flikar:
1. **Dashboard** – Senslincs iframe (finns redan)
2. **Sensordata** – Vår egen grafik med live Senslinc-data (nytt)

---

## Del 2: Visualisering av Senslinc-data med vår grafik

Det här är den roligaste och mest värdeskapande delen. Användaren vill se Senslinc-data presenterad med Geminuses egna UI-komponenter (Recharts), inte bara Senslincs iframe.

### Vad Senslinc har

Varje machine har:
- `indices` – lista av index-ID (Elasticsearch-index för tidsserie-data)
- Via `get-properties?indice={id}` → fält som `temperature`, `co2`, `humidity`, `occupancy`
- Via `search-data` med Elasticsearch DSL → historisk + realtid

### Ny hook: `src/hooks/useSenslincData.ts`

Flödet:
```
1. get-equipment (kod = fmGuid) → machine-objekt med indices-lista
2. get-properties (indice = indices[0]) → tillgängliga fält
3. search-data med DSL → senaste 7 dagars data aggregerat per dag
```

Resultatet cachas i React state. Fallback: mock-data om Senslinc inte svarar.

### Visualization Design Proposal

#### Alternativ A: Sensor-dashboard card per rum (inuti SenslincDashboardView)
När man klickar IOT+ på ett rum öppnas en panel med:
- **Gauge-kort** (4 st, beroende på tillgängliga fält):
  - 🌡️ Temperatur – stor siffra + färgindikator (blå→grön→röd)
  - 💨 CO₂ – siffra + trafikljus-ikon (grön/gul/röd)
  - 💧 Luftfuktighet – progress-bar style
  - 👥 Beläggning – % gauge
- **7-dagars sparklines** (mini-linjediagram per sensor)
- **Iframe-tab** för Senslincs fullständiga dashboard

```
┌─────────────────────────────────────────────┐
│  🌡️ Rum A101 – IoT-data          [LIVE] ●  │
├────────────┬───────────┬──────────┬──────────┤
│  21.4°C    │  623 ppm  │  42%    │  67%     │
│  Temperatur│  CO₂      │  Fukt   │  Beläggn │
│  ▓▓▓▓▓░░  │  🟡Okej  │ ▓▓▓▓░░  │ ▓▓▓▓▓▓░  │
├────────────┴───────────┴──────────┴──────────┤
│  Senaste 7 dagarna                           │
│  [LineChart: temp/co2/humidity trendlines]  │
├──────────────────────────────────────────────┤
│  [Tab: Dashboard] [Tab: Historik]            │
└──────────────────────────────────────────────┘
```

#### Alternativ B: Sensor-tab i BuildingInsightsView (befintlig sida)
Lägg till en ny "Sensors" tab bredvid Performance/Space/Asset:
- Visar aggregerade sensorvärden per byggnad (medel för alla rum)
- Klick på ett rum → drill-down till rumsnivå
- Heatmap-vy: rutnät av rum färgade efter sensor-värde (temp/co2/etc)

```
Performance | FM | Space | Asset | Sensors ← NY

┌─ Sensors ──────────────────────────────────┐
│  Välj: [Temperatur ▾] [Senaste 7 dagar ▾]  │
│                                             │
│  Snitt för Småviken: 21.8°C  [LIVE] ●      │
│                                             │
│  Rum-heatmap:                               │
│  [Röd][Gul][Grön][Grön][Gul]   → Läs av  │
│                                             │
│  Trendgraf: Dagliga snitt 7 dagar          │
│  ────────────────────────────────          │
│  22 ──╮    ╭──╮                            │
│  21   ╰────╯  ╰──                          │
│  20                                        │
└────────────────────────────────────────────┘
```

#### Rekommendation: Kombinera A + B
- **IOT+-knapp** → Alternativ A (rums-specifik panel med gauges + sparklines + iframe-tab)
- **Insights → Sensors-tab** → Alternativ B (byggnadsöversikt med heatmap + trendgraf)

---

## Konkreta implementationsdelar

### Filer att skapa/ändra

| Fil | Åtgärd |
|-----|--------|
| `supabase/functions/senslinc-query/index.ts` | Fixa `buildDashboardUrl`, lägg till `get-machine-data` action för batching |
| `src/hooks/useSenslincData.ts` | NY – discovery-flöde + Elasticsearch-queries + mock-fallback |
| `src/components/viewer/SenslincDashboardView.tsx` | Utöka med tabs: "Sensordata" (gauges + sparkline) + "Dashboard" (iframe) |
| `src/components/insights/tabs/SensorsTab.tsx` | NY – byggnadsöversikt, rum-heatmap, trendgraf |
| `src/components/insights/InsightsView.tsx` | Lägg till "Sensors" tab som använder SensorsTab |

### Senslinc edge function: ny action `get-machine-data`

Samlar all nödvändig data i ett anrop:
```typescript
case 'get-machine-data': {
  // 1. Hitta machine via fmGuid
  const machines = await senslincFetch(..., `/api/machines?code=${fmGuid}`)
  if (!machines.length) return { success: false }
  const machine = machines[0]
  
  // 2. Hämta properties för första indexet
  const properties = machine.indices.length 
    ? await senslincFetch(..., `/api/properties?indice=${machine.indices[0]}`)
    : []
    
  // 3. Hämta senaste 7 dagars daglig data via search-data
  const query = {
    size: 0,
    query: { bool: { must: [
      { term: { machine_code: fmGuid } },
      { range: { ts_beg: { gte: "now-7d" } } }
    ]}},
    aggs: { per_day: { 
      date_histogram: { field: "ts_beg", calendar_interval: "day" },
      aggs: {
        avg_temp: { avg: { field: "temperature" } },
        avg_co2:  { avg: { field: "co2" } },
        avg_hum:  { avg: { field: "humidity" } },
      }
    }}
  }
  const searchResult = await senslincFetchWithRetry(..., `/api/data-workspaces/${workspaceKey}/_search`, ..., { method: 'POST', body: query })
  
  return { success: true, data: { machine, properties, timeSeries: searchResult } }
}
```

### useSenslincData hook

```typescript
export function useSenslincData(fmGuid: string | null | undefined) {
  const [data, setData] = useState<SenslincSensorData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fmGuid) return;
    setIsLoading(true);
    
    supabase.functions.invoke('senslinc-query', {
      body: { action: 'get-machine-data', fmGuid, workspaceKey: '...' }
    }).then(({ data: result, error }) => {
      if (result?.success) {
        setData(parseTimeSeries(result.data));
        setIsLive(true);
      } else {
        setData(generateMockData(fmGuid)); // graceful fallback
        setIsLive(false);
      }
      setIsLoading(false);
    });
  }, [fmGuid]);

  return { data, isLoading, isLive, error };
}
```

### SenslincDashboardView – utökad med tabs

Nuvarande component visar bara iframe. Den utökas med:

```
[Sensordata] [Dashboard ↗]

Sensordata-tab:
- 4 gauge-kort: temp, co2, fuktighet, beläggning
- 7-dagars sparkline-diagram per sensor
- LIVE-badge om data är riktig, Demo-badge om mock

Dashboard-tab:
- Befintlig iframe (Senslincs eget gränssnitt)
```

### InsightsView – ny Sensors-tab

Ny `SensorsTab` komponent som:
1. Hämtar alla rum för vald byggnad från `allData`
2. Anropar `useSenslincData` per rum (batched – max 20 rum, paginering)
3. Visar:
   - **Sensor-väljare**: Temperatur | CO₂ | Luftfuktighet | Beläggning
   - **Rum-grid**: korten färgas efter sensor-värde med `getVisualizationColor()` (redan implementerat i `visualization-utils.ts`)
   - **Aggregerad trendgraf**: snitt per dag, senaste 7 dagar
   - **Live/Mock-badge** tydligt

Rum-grid-designen:
```tsx
<div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
  {rooms.map(room => {
    const value = roomSensorData[room.fmGuid]?.[selectedMetric];
    const color = getVisualizationColor(value, selectedMetric);
    return (
      <div 
        style={{ backgroundColor: color ? rgbToHex(color) + '40' : undefined }}
        className="p-2 rounded border text-xs text-center"
      >
        <div className="font-medium truncate">{room.name}</div>
        <div className="text-lg font-bold">{value?.toFixed(1) ?? '—'}</div>
        <div className="text-muted-foreground">{unit}</div>
      </div>
    );
  })}
</div>
```

### Teknisk utmaning: workspaceKey

`search-data` kräver ett `workspaceKey`. Det behöver antingen:
- Hämtas från machine-objektet (om det finns som fält)
- Konfigureras som secret: `SENSLINC_WORKSPACE_KEY`
- Hämtas via `get-indices` och plockas från resultatet

Vi löser detta i `get-machine-data` action med en discover-first approach – försök hitta workspace_key från `/api/indices` eller från machine-objektets egna fält.

---

## Prioritetsordning och tidplan

### Steg 1: IOT+-knappens iframe + SenslincDashboardView tabs
- Fixa `buildDashboardUrl` (5 min)
- Lägg till tabs i SenslincDashboardView: "Sensordata" + "Dashboard"
- Sensor-gauger med mock-data från `visualization-utils.ts` befintliga funktioner

### Steg 2: useSenslincData hook + edge function
- Ny `get-machine-data` action i senslinc-query
- Ny `useSenslincData` hook med discovery-flöde
- Integrera live-data i SenslincDashboardView's Sensordata-tab

### Steg 3: Sensors-tab i Insights
- Ny `SensorsTab.tsx` med rum-grid + trendgraf
- Integrera i `InsightsView.tsx` som ny tab

## Desktop och mobil
Alla komponenter byggs responsivt. På mobil:
- SenslincDashboardView (sheets/drawer) – gauger staplas vertikalt
- Sensors-tab – rum-grid 3 kolumner, sparklines förenklade
- SenslincDashboardView tab-navigation anpassad för touch

