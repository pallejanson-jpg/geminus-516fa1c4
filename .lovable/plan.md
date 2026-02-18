
# Fyra fixes: Senslinc IOT+, Kartväljare, Duplikatbyggnader

## Identifierade problem

### 1. IOT+-knappen öppnar inte dashboard (kritisk)

Rotorsak: `handleOpenIoT` i `PortfolioView.tsx` anropar `get-dashboard-url` och sätter `dashboardUrl` i `SenslincDashboardContext`. Sedan öppnar `SenslincDashboardView` hooken `useSenslincData(facilityFmGuid)` som försöker `get-machine-data` → hittar ingen maskin (Småviken är en site, inte en machine) → faller tillbaka med tom `dashboardUrl`.

Problemet: hooken överskriver `dashboardUrl` från context med den tomma fallbacken. På rad 190 i `SenslincDashboardView.tsx`:
```typescript
const dashboardUrl = data?.dashboardUrl || senslincDashboardContext?.dashboardUrl || '';
```
Om `data?.dashboardUrl` är en tom sträng (fallback-objektet har `dashboardUrl: ''`) → faller aldrig igenom till `senslincDashboardContext?.dashboardUrl`.

Fix: lägg till `|| ''` guard – använd context-URL om hook-data saknar URL:
```typescript
const dashboardUrl = (data?.dashboardUrl?.trim() ? data.dashboardUrl : null) 
  ?? senslincDashboardContext?.dashboardUrl ?? '';
```

Och i hooken `useSenslincData.ts`: fallback-objektet sätts med `dashboardUrl: siteDashboardUrl` korrekt men `siteDashboardUrl` är tom om `get-dashboard-url` anropet misslyckas. Det beror på att `get-dashboard-url` redan anropades av `handleOpenIoT` – men contexten skickas via `facilityFmGuid`, inte via `dashboardUrl` direkt. Hooken gör ett nytt anrop.

Faktiska fix: Hooken ska inte anropa `get-machine-data` när fmGuid matchar en byggnad (site). Vi vet inte i förväg. Enklast: om fallback-anropet till `get-dashboard-url` lyckas, sätt `dashboardUrl` i fallback-data.

Observerat: Anropet fungerar (curl bekräftar att `get-dashboard-url` ger rätt svar). Problemet är att `data.dashboardUrl = ''` överskuggar context-dashboardUrl på grund av `data?.dashboardUrl || ...` – tom sträng är truthy som `data?.dashboardUrl` men falsy för `||`. **Faktum: tom sträng är falsy för `||`** – alltså borde detta faktiskt fungera. Men: `data?.dashboardUrl` sätts till `siteDashboardUrl` i catch-grenen – om den är tom är den falsy och `senslincDashboardContext?.dashboardUrl` borde ta vid.

Faktisk rotorsak: Hooken gör ett `get-machine-data`-anrop, det misslyckas med "No machine found" (eftersom Småviken är en site), sedan görs ett fallback-anrop till `get-dashboard-url` – men det anropet kräver att Senslinc-credentials fungerar och returnerar rätt. Om det lyckas sätts `siteDashboardUrl` korrekt. Om `facilityFmGuid` inte är satt (null) hoppar hooken över hela processen. Om `facilityFmGuid` är satt men kontexten bara innehåller `dashboardUrl` (utan `facilityFmGuid`) → hooken anropas inte.

Kontrollera: `SenslincDashboardView` läser `facilityFmGuid = senslincDashboardContext?.facilityFmGuid ?? null`. Om IOT+-knappen sätter kontexten med `facilityFmGuid: facility.fmGuid` (vilket den gör på rad 248 i PortfolioView), borde hooken köras.

**Faktisk bug**: `handleOpenIoT` sätter redan `dashboardUrl` i kontexten på rad 244-248. Men `SenslincDashboardView.tsx` anropar hooken `useSenslincData(facilityFmGuid)` som gör ett nytt API-anrop, och under laddningstiden är `data?.dashboardUrl = ''`. Sedan när hook-data returneras (med siteDashboardUrl från fallback), sätts `data.dashboardUrl` korrekt – men dashboard-tab visas bara om `dashboardUrl` är satt vid render.

Dashboard-tab renderas conditionally: `{dashboardUrl && (<TabsTrigger value="dashboard">...)}`. Om hooken inte har returnerat ännu (isLoading=true) → `dashboardUrl = '' || senslincDashboardContext?.dashboardUrl`. Context borde ha URL från handleOpenIoT!

Kontrollera `handleOpenIoT` igen: Det anropas `get-dashboard-url` async och sätter `dashboardUrl` lokalt, sedan anropar `openSenslincDashboard({ dashboardUrl, facilityFmGuid })`. Context sätts med korrekt `dashboardUrl`. Men: `openSenslincDashboard` är en context-funktion – vi behöver verifiera att den sätter `senslincDashboardContext` korrekt.

**Sannolikt verkliga problemet**: Från Insights-sidan – det finns ingen IOT+-knapp kopplad dit. `SensorsTab` anropar `useSenslincBuildingData(building?.fmGuid)` som anropar `get-building-sensor-data`. Den returnerar site + machines slim-lista. Men `machines[].latest_values` är `null` för alla (Senslinc API returnerar `null`), och `machines[].code` matchas mot `room.fmGuid` – men room.fmGuid är en Asset+ GUID, inte Senslinc-maskinens `code`.

**Den verkliga felen i SensorsTab**: `liveMachineMap` mappar `machine.code` → `latest_values`. Men Senslinc-maskinens `code` är inte samma som rummet/Assets fmGuid. Det är en annan identifierare. Därför matchar aldrig rum mot maskiner och all data är mockdata.

### 2. Kartans BuildingSidebar – ta bort den

I `InsightsView.tsx` renderas `<MapView initialColoringMode={mapColoringMode} />` i sidopanelen. `MapView` har en inbyggd `BuildingSidebar` som alltid visas (absolut positionerad, täcker kartan). Ska tas bort när kartan visas i Insights-kontexten.

Enklast: Lägg till en `hideSidebar?: boolean` prop till `MapView` och skicka `hideSidebar={true}` från `InsightsView`.

### 3. Duplikatbyggnader (Stadshuset Nyköping)

Databas bekräftar: Två poster för Stadshuset Nyköping:
- `fm_guid: 7cad5eda-...`, `complex_common_name: 'Stockholmshem'` (Asset+ data)
- `fm_guid: acc-bim-building-...`, `complex_common_name: null` (ACC BIM-import)

ACC-importen skapar en ny Building-post med prefix `acc-bim-building-...` utan `complex_common_name`. Dessa hamnar i "Other buildings" i portfolio.

Fix på frontend: I `PortfolioView.tsx`, filtrera bort assets med `fmGuid` som börjar på `acc-bim-building-` ur facilities-listan. Dessa är tekniska BIM-imports utan komplex-tillhörighet och ska inte visas separat i portfolion.

Alternativt (renare men mer arbete): Matcha mot befintliga buildings och merga. Men det är komplex logik.

**Föreslagen fix**: Filtrera bort `acc-bim-building-`-prefix-buildings från `navigatorTreeData` i `PortfolioView.tsx`-filtreringen, eftersom de är dubbletter av Asset+-buildings.

### 4. Senslinc data är mockdata (inte riktig data)

**Rotorsak**: `get-building-sensor-data` returnerar machines med `latest_values: null` (Senslinc API ger inte latest_values direkt på maskinlistan). Dessutom matchar `machine.code` (Senslinc-identifierare) inte `room.fmGuid` (Asset+ GUID).

**Fix**: `SensorsTab` visar alltid mockdata för rum eftersom det inte finns en mappning mellan Senslinc-machines och Asset+-rum. Det enda rätta sättet är att visa faktisk sensordata är antingen:
- Anropa `get-machine-data` per rum (dyrt, N anrop)
- Visa aggregerade site-siffror (från `get-building-sensor-data` med Elasticsearch)

Pragmatisk fix: Markera rum som har matchande `machine.code` med riktig data, övriga med lila/mock-stil. Visa tydligt att data är beräknade snitt från Senslinc site-level (inte per-rum) när det är live.

**Enklast och mest ärligt**: `SensorsTab` ska visa att datan är mock för de rum som inte har matchande Senslinc-maskin, men **för byggnaden som helhet** (Småviken) ska vi faktiskt visa riktig data från site-nivå.

## Konkreta filändringar

### Fix 1: `src/components/viewer/SenslincDashboardView.tsx`
Rad 190 – skärp dashboardUrl-läsningen:
```typescript
const dashboardUrl = (data?.dashboardUrl?.trim() || senslincDashboardContext?.dashboardUrl || '');
```

Dessutom: om `isLoading` och context har URL → visa dashboard-tab direkt, vänta inte på hook.

### Fix 2: `src/components/map/MapView.tsx`
Lägg till `hideSidebar?: boolean` prop. Wrap `BuildingSidebar` i `{!hideSidebar && (<BuildingSidebar .../>)}`.

### Fix 3: `src/components/insights/InsightsView.tsx`
Skicka `hideSidebar={true}` till `MapView`.

### Fix 4: `src/components/portfolio/PortfolioView.tsx`
I `facilities` useMemo, filtrera bort ACC BIM-buildings:
```typescript
return navigatorTreeData
  .filter(building => !building.fmGuid?.startsWith('acc-bim-building-'))
  .map((building, index) => { ... })
```

### Fix 5: `src/components/insights/tabs/SensorsTab.tsx`
Tydligare separation: visa "Live-data saknas per rum, visar estimated" när `isLive=false`. Städa upp mock-data-genereringen så lila/streckad stil visas konsekvent.

## Prioritet

1. **Dashboard-URL-bugg** (Fix 1 + kontrollera context-flöde) – kritisk, IOT+ fungerar inte
2. **ACC-duplikat** (Fix 4) – hög, förvirrar användaren
3. **Kartväljare** (Fix 2+3) – medel, estetisk
4. **SensorsTab mock-tydlighet** (Fix 5) – låg, data visas men är alltid mock

## Notering om Senslincs riktiga data

Curl-test bekräftar att `get-dashboard-url` för Småviken returnerar korrekt `https://swg-group.productinuse.com/site/28148/home/`. `get-building-sensor-data` hämtar site + machines – men `machine.code` är Senslinc-intern kod, inte Asset+ fmGuid. Det finns ingen direkt mappning utan manuell konfiguration i Asset+ (att lägga maskin-koden som attribut på rum). Därför kan vi inte visa riktig per-rum-data utan den mappningen.

**Vad vi KAN göra**: Visa riktig aggregerad site-data (medeltemperatur för hela Småviken) via `get-building-sensor-data` + Elasticsearch på site-nivå. Det behöver ett nytt edge function-anrop för time-series på site-nivå.
