

# Uppdatering av Senslinc Integration Plan

## Vad som behöver uppdateras

Den nuvarande planen (`docs/plans/senslinc-integration-plan.md`) innehåller felaktiga antaganden om API-strukturen. Det viktigaste som behöver korrigeras:

### Felaktigt i nuvarande plan
- Antar att tidsseriedata hämtas via `GET /api/readings` och `GET /api/sensors`
- Enkla REST-endpoints som inte existerar
- Ingen hantering av rate-limiting

### Korrekt API-struktur (baserat på ny kunskap)
- Tidsseriedata hämtas via **Elasticsearch DSL**
- Tre-stegs discovery-flöde: Indices → Properties → Search
- Rate-limiting med 429-svar kräver exponential backoff

---

## Del 3: Insights med Riktig Data (UPPDATERAD)

### Nytt API-flöde för tidsseriedata

```text
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐
│  1. Discovery   │───▶│  2. Metadata    │───▶│  3. Elasticsearch Query │
│ GET /api/indices│    │GET /api/properties│   │POST /api/data-workspaces│
│                 │    │   ?indice={pk}  │    │  /{key}/_search          │
└─────────────────┘    └─────────────────┘    └─────────────────────────┘
```

### Nya edge function actions

| Action | Endpoint | Beskrivning |
|--------|----------|-------------|
| `get-indices` | `GET /api/indices` | Hämta tillgängliga data workspaces |
| `get-properties` | `GET /api/properties?indice={pk}` | Hämta sensortyper för ett index |
| `search-data` | `POST /api/data-workspaces/{key}/_search` | Elasticsearch DSL-query |

### Elasticsearch DSL Query-exempel

```typescript
// För att hämta temperatur och CO2 för ett rum under senaste veckan
const query = {
  query: {
    bool: {
      must: [
        { term: { machine_code: fmGuid } },
        { 
          range: { 
            ts_beg: { 
              gte: "2026-02-01T00:00:00Z", 
              lte: "2026-02-05T23:59:59Z" 
            } 
          }
        }
      ]
    }
  },
  aggs: {
    avg_temperature: { avg: { field: "temperature" } },
    avg_co2: { avg: { field: "co2" } },
    hourly: {
      date_histogram: { field: "ts_beg", interval: "hour" },
      aggs: {
        temp: { avg: { field: "temperature" } },
        co2: { avg: { field: "co2" } }
      }
    }
  },
  size: 1000,
  sort: [{ ts_beg: "asc" }]
};
```

### Rate-limiting och exponential backoff

```typescript
// I senslinc-query edge function
async function senslincFetchWithRetry(
  apiUrl: string, 
  endpoint: string, 
  token: string,
  options?: { method?: string; body?: unknown }
): Promise<unknown> {
  const maxRetries = 3;
  let delay = 1000; // Start med 1 sekund
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(`${apiUrl}${endpoint}`, {
      method: options?.method || 'GET',
      headers: { 
        'Authorization': `JWT ${token}`,
        'Content-Type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    
    if (response.status === 429) {
      console.log(`[Senslinc] Rate limited, retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
      continue;
    }
    
    if (!response.ok) {
      throw new Error(`Senslinc API error: ${response.status}`);
    }
    
    return response.json();
  }
  
  throw new Error('Rate limit exceeded after retries');
}
```

---

## Uppdaterad useSenslincData hook

```typescript
// src/hooks/useSenslincData.ts
interface SenslincDataResult {
  data: SenslincTimeSeriesData | null;
  isLoading: boolean;
  error: string | null;
  isMock: boolean;  // NY: Indikerar om detta är mock-data
  source: 'live' | 'mock' | 'cache';
}

export function useSenslincData(fmGuid: string, options?: {
  metrics?: ('temperature' | 'co2' | 'humidity' | 'energy')[];
  period?: 'day' | 'week' | 'month';
  aggregation?: 'hourly' | 'daily';
}): SenslincDataResult {
  const [result, setResult] = useState<SenslincDataResult>({
    data: null,
    isLoading: true,
    error: null,
    isMock: false,
    source: 'mock',
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 1. Discovery: Hämta indices
        const indicesRes = await supabase.functions.invoke('senslinc-query', {
          body: { action: 'get-indices' }
        });
        
        if (!indicesRes.data?.success) {
          throw new Error('Failed to fetch indices');
        }
        
        // 2. Hitta rätt workspace för denna entitet
        const workspace = findWorkspaceForEntity(indicesRes.data.data, fmGuid);
        
        // 3. Hämta properties för att veta vilka metrics som finns
        const propsRes = await supabase.functions.invoke('senslinc-query', {
          body: { action: 'get-properties', indiceId: workspace.pk }
        });
        
        // 4. Bygg och kör Elasticsearch-query
        const searchRes = await supabase.functions.invoke('senslinc-query', {
          body: { 
            action: 'search-data',
            workspaceKey: workspace.key,
            query: buildElasticsearchQuery(fmGuid, options)
          }
        });
        
        setResult({
          data: transformSearchResults(searchRes.data),
          isLoading: false,
          error: null,
          isMock: false,
          source: 'live',
        });
      } catch (error) {
        // Fallback till mock-data med tydlig markering
        setResult({
          data: generateMockData(fmGuid, options),
          isLoading: false,
          error: error.message,
          isMock: true,
          source: 'mock',
        });
      }
    };

    fetchData();
  }, [fmGuid, options]);

  return result;
}
```

---

## Visuell strategi: Röd markering för mock-data

| Komponent | Live-data | Mock-data |
|-----------|-----------|-----------|
| Recharts LineChart | Heldragen linje, standard färg | Streckad linje (`strokeDasharray="5 5"`), röd färg |
| KPI-kort | Grön LIVE-badge | Röd MOCK-badge |
| Ilean-knapp | Pulserande grön ring | Normal (ingen puls) |

```tsx
// Exempel i PerformanceTab.tsx
const { data, isMock } = useSenslincData(building.fmGuid);

<LineChart data={data?.timeseries}>
  <Line 
    dataKey="temperature"
    stroke={isMock ? '#ef4444' : 'hsl(var(--primary))'}
    strokeDasharray={isMock ? '5 5' : undefined}
  />
</LineChart>

{isMock && (
  <Badge variant="destructive" className="absolute top-2 right-2">
    MOCK
  </Badge>
)}
```

---

## Uppdaterad filstruktur

| Fil | Ändring |
|-----|---------|
| `supabase/functions/senslinc-query/index.ts` | Lägg till: `get-indices`, `get-properties`, `search-data` med exponential backoff |
| `src/hooks/useSenslincData.ts` | NY: React hook med Elasticsearch-logik och mock-fallback |
| `src/components/insights/tabs/PerformanceTab.tsx` | Använd `useSenslincData`, visa isMock-indikator |
| `docs/api/senslinc/overview.md` | NY: Dokumentation av Senslinc API-struktur |
| `docs/plans/senslinc-integration-plan.md` | Uppdatera Del 3 med korrekt API-flöde |

---

## API-dokumentation (ny sektion i planen)

### Senslinc Elasticsearch API

| Endpoint | Metod | Beskrivning |
|----------|-------|-------------|
| `/api/indices` | GET | Lista alla data workspaces |
| `/api/properties` | GET | Sensortyper för ett index (query: `?indice={pk}`) |
| `/api/data-workspaces/{key}/_search` | POST | Elasticsearch DSL-query |

### Mappning till FM-entiteter

| Senslinc | Asset+ | Fält för mappning |
|----------|--------|-------------------|
| Site | Building | `code` = `fmGuid` |
| Line | Building Storey | `code` = `fmGuid` |
| Machine | Space / Asset | `code` = `fmGuid` |

### Vanliga Elasticsearch-fält

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `ts_beg` | datetime | Mätningens starttid |
| `ts_end` | datetime | Mätningens sluttid |
| `machine_code` | string | FM GUID för rum/asset |
| `temperature` | float | Temperatur i °C |
| `co2` | float | CO2 i ppm |
| `humidity` | float | Luftfuktighet i % |
| `energy_kwh` | float | Energiförbrukning |

---

## Nästa steg

1. **Verifiera indices**: Köra `get-indices` för att se vilka workspaces som finns
2. **Testa en query**: Hämta temperaturdata för ett känt rum (t.ex. i Smv)
3. **Implementera hook**: Skapa `useSenslincData.ts` med korrekt flöde
4. **Uppdatera UI**: Integrera i PerformanceTab med mock-fallback

