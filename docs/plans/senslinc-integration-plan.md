# Plan: Senslinc Integration - Phase 2

**Datum**: 2026-02-05
**Status**: Planering
**Uppdaterad**: 2026-02-05 (Elasticsearch DSL-korrigering)

---

## Översikt

Denna plan beskriver den fullständiga integrationen av Senslinc (InUse) för att:
1. Koppla `sensorUrl` till IoT-knappar i hela applikationen
2. Aktivera Ilean-assistenten med `ileanUrl` från Asset+
3. Hämta riktig sensordata till Insights-dialogen via Recharts

---

## Del 1: Sensor-URL Integration (IoT-knappar)

### Nuläge
- IoT-knapp finns på rum/assets som öppnar Senslinc dashboard i iframe
- URL hämtas via `get-dashboard-url` i `senslinc-query` edge function
- Mappning sker via FM GUID i `code`-fältet

### Mål
| Entitet | Källa för sensorUrl | Fallback |
|---------|---------------------|----------|
| Byggnad | `attributes.sensorUrl` från Asset+ | `/api/sites?code={fmGuid}` |
| Våning | `attributes.sensorUrl` från Asset+ | `/api/lines?code={fmGuid}` |
| Rum | `attributes.sensorUrl` från Asset+ | `/api/machines?code={fmGuid}` |
| Tillgång | `attributes.sensorUrl` från Asset+ | `/api/machines?code={fmGuid}` |

### Implementation

**Steg 1.1: Uppdatera `senslinc-query` edge function**

Lägg till ny action `get-sensor-url` som:
1. Först kontrollerar om `sensorUrl` finns i attributen
2. Fallback: söker i Senslinc API

```typescript
case 'get-sensor-url': {
  const { fmGuid, sensorUrlFromAsset } = params;
  
  // Om sensorUrl finns i Asset+, använd den
  if (sensorUrlFromAsset) {
    return jsonResponse({ 
      success: true, 
      data: { dashboardUrl: sensorUrlFromAsset, source: 'asset-plus' } 
    });
  }
  
  // Fallback: sök i Senslinc
  return await getDashboardUrl(fmGuid);
}
```

**Steg 1.2: Uppdatera IoT-knappen i QuickActions**

Visa IoT-knapp för alla entiteter som har `sensorUrl` eller matchar i Senslinc.

---

## Del 2: Ilean-assistent Integration

### Nuläge
- Ilean-knappen (`IleanButton.tsx`) söker efter `ilean`-attribut i `selectedFacility`
- Fallback till global config i localStorage
- Visas som iframe

### Mål
- Hämta `ileanUrl` från byggnadens attribut i Asset+ (t.ex. "Smv")
- Aktivera Ilean automatiskt när URL finns
- Visa tydlig indikation när Ilean är tillgänglig

### Implementation

**Steg 2.1: Förbättra URL-sökning i IleanButton**

Prioriteringsordning:
1. `attributes.ileanUrl` eller `attributes.ileanURL` på selected facility
2. `attributes.ilean` (legacy)
3. Bygg URL från Senslinc API-URL: `https://{domain}/ilean`

```typescript
// I IleanButton.tsx useEffect:
const getIleanUrl = () => {
  // 1. Direkt från facility attribut
  const attrs = (selectedFacility as any)?.attributes || {};
  const ileanUrlKey = Object.keys(attrs).find(k => 
    k.toLowerCase() === 'ileanurl'
  );
  if (ileanUrlKey && attrs[ileanUrlKey]?.value) {
    return attrs[ileanUrlKey].value;
  }
  
  // 2. Legacy "ilean" attribut
  const ileanKey = Object.keys(attrs).find(k => 
    k.toLowerCase().includes('ilean')
  );
  if (ileanKey && attrs[ileanKey]?.value) {
    return attrs[ileanKey].value;
  }
  
  // 3. Global config
  // ...
};
```

**Steg 2.2: Auto-aktivering av Ilean**

När `ileanUrl` finns tillgänglig:
- Visa en liten "puls" på Ilean-knappen
- Tooltip visar "Ilean tillgänglig för {byggnad}"

---

## Del 3: Insights med Riktig Data via Elasticsearch DSL

### Nuläge
- InsightsView använder Recharts för diagram
- PerformanceTab har mock-data (energiförbrukning baserad på fmGuid-hash)
- Ingen koppling till Senslinc API

### Mål
- Hämta riktig sensordata från Senslinc (temperatur, CO2, fukt, belysning, etc.)
- Visa i befintliga Recharts-komponenter (BarChart, PieChart, LineChart)
- Undvik iframe-inbäddning (blockas av Senslinc + ger inkonsekvent design)
- **VIKTIG**: Tidsseriedata hämtas via Elasticsearch DSL, inte enkla REST-endpoints

### API-flöde för tidsseriedata

```text
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐
│  1. Discovery   │───▶│  2. Metadata    │───▶│  3. Elasticsearch Query │
│ GET /api/indices│    │GET /api/properties│   │POST /api/data-workspaces│
│                 │    │   ?indice={pk}  │    │  /{key}/_search          │
└─────────────────┘    └─────────────────┘    └─────────────────────────┘
```

### Senslinc Elasticsearch API

| Endpoint | Metod | Beskrivning |
|----------|-------|-------------|
| `/api/indices` | GET | Lista alla data workspaces |
| `/api/properties` | GET | Sensortyper för ett index (query: `?indice={pk}`) |
| `/api/data-workspaces/{key}/_search` | POST | Elasticsearch DSL-query |

### Nya edge function actions

| Action | Endpoint | Beskrivning |
|--------|----------|-------------|
| `get-indices` | `GET /api/indices` | Hämta tillgängliga data workspaces |
| `get-properties` | `GET /api/properties?indice={pk}` | Hämta sensortyper för ett index |
| `search-data` | `POST /api/data-workspaces/{key}/_search` | Elasticsearch DSL-query |

### Implementation

**Steg 3.1: Utöka `senslinc-query` med Elasticsearch-stöd**

```typescript
// Rate-limiting med exponential backoff
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

// Nya actions
case 'get-indices': {
  const data = await senslincFetchWithRetry(cleanApiUrl, '/api/indices', token);
  return jsonResponse({ success: true, data });
}

case 'get-properties': {
  const { indiceId } = params;
  const data = await senslincFetchWithRetry(
    cleanApiUrl, 
    `/api/properties?indice=${indiceId}`, 
    token
  );
  return jsonResponse({ success: true, data });
}

case 'search-data': {
  const { workspaceKey, query } = params;
  const data = await senslincFetchWithRetry(
    cleanApiUrl,
    `/api/data-workspaces/${workspaceKey}/_search`,
    token,
    { method: 'POST', body: query }
  );
  return jsonResponse({ success: true, data });
}
```

**Steg 3.2: Elasticsearch DSL Query-struktur**

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

**Steg 3.3: Skapa React hook för Senslinc-data**

```typescript
// src/hooks/useSenslincData.ts
interface SenslincDataResult {
  data: SenslincTimeSeriesData | null;
  isLoading: boolean;
  error: string | null;
  isMock: boolean;
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

**Steg 3.4: Uppdatera PerformanceTab med riktig data**

```tsx
// I PerformanceTab.tsx:
const { data: senslincData, isLoading, isMock } = useSenslincData(building.fmGuid);

const energyByBuilding = useMemo(() => {
  if (senslincData?.energy) {
    return senslincData.energy.map(e => ({
      name: e.buildingName,
      kwhPerSqm: e.kwhPerSqm,
      rating: calculateRating(e.kwhPerSqm),
    }));
  }
  // Fallback till nuvarande mock-logik
  return mockEnergyData;
}, [senslincData]);
```

---

## Del 4: UI/UX Design

### Visuell strategi: Röd markering för mock-data

| Komponent | Live-data | Mock-data |
|-----------|-----------|-----------|
| Recharts LineChart | Heldragen linje, standard färg | Streckad linje (`strokeDasharray="5 5"`), röd färg (#ef4444) |
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

### Recharts-tema

Använd befintlig färgpalett från design-systemet:

```typescript
const chartColors = {
  temperature: 'hsl(var(--destructive))',      // Röd
  humidity: 'hsl(220, 80%, 55%)',               // Blå
  co2: 'hsl(142, 76%, 36%)',                    // Grön
  energy: 'hsl(48, 96%, 53%)',                  // Gul
  occupancy: 'hsl(262, 83%, 58%)',              // Lila
};
```

### Responsiv design

- Mobil: Staplade kort med mini-diagram
- Desktop: Grid-layout med interaktiva diagram
- Touch-stöd för tooltips och zoom

---

## Mappning: Senslinc → Asset+

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

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `supabase/functions/senslinc-query/index.ts` | Lägg till: `get-indices`, `get-properties`, `search-data` med exponential backoff |
| `src/hooks/useSenslincData.ts` | NY: React hook med Elasticsearch-logik och mock-fallback |
| `src/components/chat/IleanButton.tsx` | Förbättrad URL-sökning, auto-aktivering |
| `src/components/insights/tabs/PerformanceTab.tsx` | Använd `useSenslincData`, visa isMock-indikator |
| `docs/api/senslinc/overview.md` | NY: Dokumentation av Senslinc API-struktur |

---

## Nästa steg

1. **Verifiera indices**: Köra `get-indices` för att se vilka workspaces som finns
2. **Testa en query**: Hämta temperaturdata för ett känt rum (t.ex. i Smv)
3. **Implementera hook**: Skapa `useSenslincData.ts` med korrekt flöde
4. **Uppdatera UI**: Integrera i PerformanceTab med mock-fallback

---

## Frågor till användaren

1. Vilka sensortyper är viktigast att visa först? (Temperatur, CO2, Energi?)
2. Ska vi visa data för enskilda byggnader eller hela portfolion i Insights?
3. Finns det specifika attributnamn i Asset+ för `ileanUrl` och `sensorUrl`?
4. Vill du ha möjlighet att jämföra byggnader i samma diagram?
