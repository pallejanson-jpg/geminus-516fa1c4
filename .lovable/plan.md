

## Lagg till Senslinc IoT-verktyg i Gunnar

### Oversikt

Gunnar far tre nya verktyg som anropar `senslinc-query` edge-funktionen internt (server-till-server via `fetch`) for att soka IoT-data -- sensorer, larm, matvarden, dashboards.

---

### Fil: `supabase/functions/gunnar-chat/index.ts`

#### 1. Lagg till tre nya tool-definitioner i `tools`-arrayen

| Verktyg | Beskrivning | Parametrar |
|---------|-------------|------------|
| `senslinc_get_equipment` | Hitta IoT-utrustning kopplad till ett FM GUID (rum/asset/byggnad). Returnerar maskininfo och dashboard-URL. | `fm_guid` (required) |
| `senslinc_get_sites` | Lista alla Senslinc-siter (byggnader) och deras maskiner. Kan filtreras med `site_code`. | `site_code` (optional) |
| `senslinc_search_data` | Sok tidsseriedata (temperatur, CO2, energi) fran Senslinc Elasticsearch. Kraver `workspace_key` och en `query` (Elasticsearch DSL). | `workspace_key` (required), `time_range` (optional, default "now-24h"), `property_name` (optional), `machine_code` (optional), `size` (optional, default 100) |

#### 2. Lagg till tre exekveringsfunktioner

Alla tre anropar `senslinc-query` edge-funktionen via intern `fetch`:

```typescript
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

async function callSenslincQuery(action: string, params: Record<string, unknown>) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/senslinc-query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ action, ...params }),
  });
  return resp.json();
}
```

- **`execSenslincGetEquipment`**: Anropar `get-dashboard-url` med `fmGuid`. Returnerar maskinnamn, typ (machine/site/line), dashboard-URL, och ev. sensordata.
- **`execSenslincGetSites`**: Anropar `get-sites` (alla siter) eller `get-site-equipment` (filterat pa `siteCode`).
- **`execSenslincSearchData`**: Bygger en Elasticsearch-query med `range`-filter pa `@timestamp` och optional `term`-filter pa `machine_code` / `property_name`. Anropar `search-data`.

#### 3. Registrera i `executeTool` switch-satsen

Lagg till tre nya case:
```
case "senslinc_get_equipment": return execSenslincGetEquipment(args);
case "senslinc_get_sites": return execSenslincGetSites(args);
case "senslinc_search_data": return execSenslincSearchData(args);
```

#### 4. Uppdatera systemprompt

Lagg till ett nytt avsnitt i `buildSystemPrompt`:

```
SENSLINC (IoT / SENSOR DATA):
You have tools to query IoT sensor data from the Senslinc system.
- Use senslinc_get_equipment to find sensors linked to a specific room, asset, or building (via FM GUID).
- Use senslinc_get_sites to list all monitored sites/buildings.
- Use senslinc_search_data to query time-series measurements (temperature, CO2, humidity, energy).
- When presenting sensor data, include the dashboard link: [📊 Senslinc Dashboard](URL)
- The search_data tool uses Elasticsearch DSL -- build queries with time_range (e.g. "now-24h", "now-7d"), property_name, and machine_code filters.
```

---

### Teknisk detalj: Elasticsearch-query som byggs av `senslinc_search_data`

```json
{
  "size": 100,
  "query": {
    "bool": {
      "must": [
        { "range": { "@timestamp": { "gte": "now-24h", "lte": "now" } } }
      ],
      "filter": [
        { "term": { "machine_code": "..." } },
        { "term": { "property_name": "..." } }
      ]
    }
  },
  "sort": [{ "@timestamp": { "order": "desc" } }]
}
```

Gunnar kan anpassa `time_range`, `machine_code` och `property_name` baserat pa anvandardens fraga. Han kan aven kedja: forst `senslinc_get_equipment` for att hitta `machine_code`, sedan `senslinc_search_data` for att hamta matvarden.

---

### Sammanfattning

| Andring | Fil |
|---------|-----|
| 3 nya tool-definitioner | `gunnar-chat/index.ts` |
| 3 nya exec-funktioner + gemensam `callSenslincQuery` helper | `gunnar-chat/index.ts` |
| 3 nya case i `executeTool` | `gunnar-chat/index.ts` |
| Utokat systemprompt med Senslinc-instruktioner | `gunnar-chat/index.ts` |

