

## Hamta riktig Air Quality-data fran Senslinc till RoomSensorDetailSheet

### Problemanalys

Nuvarande flode i `useSenslincData` -> `senslinc-query` edge function:
1. Hittar maskinen via `/api/machines?code={fmGuid}` -- FUNGERAR
2. Hamtar properties via `/api/properties?indice={id}` -- FUNGERAR
3. Forsoker hamta tidsseriedata via `/api/data-workspaces/{key}/_search` -- 404 (FINNS INTE pa denna Senslinc-instans)

Tva buggar i workspace-key-discovery:
- Koden soker `properties[0].indice_workspace` men faltet heter `natural_key[0]`
- ES-queryn anvander `temperature`, `co2` men riktiga faltnamn ar `temperature_mean`, `co2_mean`, `humidity_mean`, `occupation_mean`, `light_mean`

Men aven om dessa fixas sa returnerar `data-workspaces/_search`-endpointen 404 pa `api.swg-group.productinuse.com`. Vi behover en alternativ datahamilingsmetod.

### Losning: Anvand Senslinc `/api/machines/{pk}/data/` endpoint

Senslinc ProductInUse-plattformen har ett alternativt data-API:
- `/api/machines/{pk}/data/?indice_key={key}` -- hamtar senaste data
- `/api/machines/{pk}/data/?indice_key={key}&from={iso_date}&to={iso_date}` -- hamtar historik

### Andringar

**1. Edge function: `senslinc-query/index.ts`**

Uppdatera `get-machine-data`-actionen:

- **Steg 2b (ny):** Forsok hamta data via `/api/machines/{machinePk}/data/?indice_key={key}&from={7daysAgo}&to={now}` (det alternativa API:et)
- **Steg 2c:** Om det ocksa misslyckas, forsok hamta senaste varden via `/api/machines/{machinePk}/data/?indice_key={key}&last=1` (bara aktuella varden)
- **Workspace key fix:** Hamta workspace key fran `properties[0].natural_key[0]` istallet for `indice_workspace`
- **Faltnamn-fix:** Anvand `temperature_mean`, `co2_mean`, `humidity_mean`, `occupation_mean`, `light_mean` i ES-queries som fallback
- Behall ES data-workspaces som forsta forsok (for andra instanser som stodjer det)

Lagg aven till ny action `get-machine-air-quality` som specifikt hamtar Air Quality-data med alla tillgangliga indikatorer fran alla indices (2479 = raw, 1857 = processed, 3588 = pulsed).

**2. Hook: `useSenslincData.ts`**

Utoka hook-returnvarden med fler sensorfalt:
- `light` (belysning/lux) -- finns i indice 2479 som `light_mean`
- Utoka `SenslincTimePoint` med `light: number | null`
- Utoka `SenslincCurrentValues` med `light: number | null`
- Utoka `availableFields` for att inkludera `'light'`

Uppdatera `parseTimeSeries` for att hantera bade de gamla och nya faltnamnen:
- `temperature` ELLER `temperature_mean`
- `co2` ELLER `co2_mean`
- `humidity` ELLER `humidity_mean`
- `occupancy` ELLER `occupation_mean`
- `light` ELLER `light_mean`

**3. UI: `RoomSensorDetailSheet.tsx`**

Bygg om sheeten med riktig data-formatering i Geminus-stil:

- **Header:** Visa rumsnamn, maskinnamn (label fran Senslinc), och LIVE/Demo-badge
- **Air Quality Score (ny):** Berakna en sammanslagen luftkvalitetspoangsats baserat pa CO2, temperatur, fuktighet -- visa som cirkeldiagram eller stor siffra
- **Sensorpaneler (forbattrad):** Utoka fran 4 till 5 kort (lagg till Belysning/Light)
- **Trenddiagram (forbattrad):** Visa timvis data istallet for daglig om tillganglig, lagg till ljus-linje
- **Comfort Explanation (ny):** Visa en textbaserad forklaring av luftkvalitet (inspirerat av Senslicns "Comfort Explanation"-vy som finns som meny pa maskinen)
- **Maskininfo (ny):** Visa maskinens label, site, line, senast uppdaterad

### Viktiga detaljer

**Senslinc Air Quality dashboard visar:**
- Temperatur (C)
- CO2 (ppm)
- Luftfuktighet (%)
- Belysning (lux)
- Belaggning (%)
- Comfort Score (beraknad)
- 24h/7d trender

**Tillgangliga Senslinc-menyer per maskin:**
- `[Room] Home` (room_analysis) -- huvudvy med Air Quality
- `[Room] Comfort Explanation` -- forklaringar
- `[Room] Time Series` -- tidsserier (snap)
- `Logs` -- handelseogg
- `ilean` -- AI-assistent

### Filer som andras

| Fil | Andring |
|---|---|
| `supabase/functions/senslinc-query/index.ts` | 1) Fixa workspace key discovery (natural_key[0]), 2) Fixa faltnamn i ES-query, 3) Lagg till alternativ datahamilning via /api/machines/{pk}/data/, 4) Ny action get-machine-air-quality |
| `src/hooks/useSenslincData.ts` | 1) Utoka interface med light-falt, 2) Forbattra parseTimeSeries for bade gamla/nya faltnamn, 3) Lagg till light i mock-data |
| `src/components/insights/RoomSensorDetailSheet.tsx` | 1) Lagg till Belysning/Light GaugeCard, 2) Lagg till Air Quality score-berakning, 3) Visa maskin-label och site-info, 4) Forbattra trenddiagram med light-toggle |
| `src/lib/visualization-utils.ts` | Lagg till `light` VisualizationType med config (0-2000 lux range) |

### Ingen databasandring

All data hamtas i realtid fran Senslinc API.

### Prioritetsordning

1. **Edge function fix** -- fixa workspace key + faltnamn + lagg till alternativ data-endpoint (detta unlockar all riktig data)
2. **Hook-utvidgning** -- utoka med light-falt och forbattrad parsing
3. **UI-ombyggnad** -- visa riktig data i Geminus-design med Air Quality score

