 # Plan: Senslinc Integration - Phase 2
 
 **Datum**: 2026-02-05
 **Status**: Planering
 
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
 
 ## Del 3: Insights med Riktig Data via Recharts
 
 ### Nuläge
 - InsightsView använder Recharts för diagram
 - PerformanceTab har mock-data (energiförbrukning baserad på fmGuid-hash)
 - Ingen koppling till Senslinc API
 
 ### Mål
 - Hämta riktig sensordata från Senslinc (temperatur, CO2, fukt, belysning, etc.)
 - Visa i befintliga Recharts-komponenter (BarChart, PieChart, LineChart)
 - Undvik iframe-inbäddning (blockas av Senslinc + ger inkonsekvent design)
 
 ### Senslinc Data-endpoints (baserat på dokumentation)
 
 | Endpoint | Beskrivning | Data |
 |----------|-------------|------|
 | `GET /api/sites` | Lista byggnader | `name`, `code`, `pk` |
 | `GET /api/lines` | Lista våningar | `name`, `code`, `site` |
 | `GET /api/machines` | Lista rum/utrustning | `name`, `code`, `line`, `equipment_type` |
 | `GET /api/readings` | Historiska mätvärden | `timestamp`, `value`, `sensor_id` |
 | `GET /api/sensors` | Lista sensorer | `name`, `type`, `machine` |
 
 ### Implementation
 
 **Steg 3.1: Utöka `senslinc-query` med nya actions**
 
 ```typescript
 // Nya actions för Insights
 case 'get-readings': {
   // Hämta mätvärden för en sensor/maskin
   // Params: { machineId, sensorType, from, to }
   const readings = await senslincFetch(
     cleanApiUrl, 
     `/api/readings?machine=${machineId}&from=${from}&to=${to}`, 
     token
   );
   return jsonResponse({ success: true, data: readings });
 }
 
 case 'get-sensors': {
   // Hämta sensorer för en maskin/site
   // Params: { siteCode?, machineCode? }
   const sensors = await senslincFetch(
     cleanApiUrl, 
     `/api/sensors?site=${siteCode}`, 
     token
   );
   return jsonResponse({ success: true, data: sensors });
 }
 
 case 'get-aggregated-data': {
   // Aggregerad data för dashboard
   // Params: { siteCode, period: 'day'|'week'|'month' }
   // Returnerar: avg temp, avg CO2, total energi, etc.
 }
 ```
 
 **Steg 3.2: Skapa React hook för Senslinc-data**
 
 ```typescript
 // src/hooks/useSenslincData.ts
 export function useSenslincData(fmGuid: string, options?: {
   sensorTypes?: ('temperature' | 'co2' | 'humidity' | 'energy')[];
   period?: 'day' | 'week' | 'month';
 }) {
   const [data, setData] = useState<SenslincData | null>(null);
   const [isLoading, setIsLoading] = useState(true);
   const [error, setError] = useState<string | null>(null);
   
   useEffect(() => {
     fetchSenslincData(fmGuid, options)
       .then(setData)
       .catch(setError)
       .finally(() => setIsLoading(false));
   }, [fmGuid, options]);
   
   return { data, isLoading, error };
 }
 ```
 
 **Steg 3.3: Uppdatera PerformanceTab med riktig data**
 
 ```tsx
 // I PerformanceTab.tsx:
 const { data: senslincData, isLoading } = useSenslincData(building.fmGuid);
 
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
 
 **Steg 3.4: Lägg till nya diagram för sensordata**
 
 | Diagram | Data | Visualisering |
 |---------|------|---------------|
 | Inomhusklimat | Temp, CO2, Fukt | LineChart med tidsserier |
 | Energiförbrukning | kWh per dag/vecka | AreaChart |
 | Beläggning | Occupancy % | BarChart per rum |
 | Miljöprestanda | CO2-utsläpp | Gauge/RadialBar |
 
 ---
 
 ## Del 4: UI/UX Design
 
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
 
 ## Filer som ändras
 
 | Fil | Ändring |
 |-----|---------|
 | `supabase/functions/senslinc-query/index.ts` | Nya actions: `get-readings`, `get-sensors`, `get-aggregated-data` |
 | `src/hooks/useSenslincData.ts` | NY - React hook för Senslinc-data |
 | `src/components/chat/IleanButton.tsx` | Förbättrad URL-sökning, auto-aktivering |
 | `src/components/insights/tabs/PerformanceTab.tsx` | Ersätt mock-data med riktig data |
 | `src/components/insights/BuildingInsightsView.tsx` | Lägg till sensordata-diagram |
 
 ---
 
 ## API-endpoints som behövs
 
 ### Senslinc API (att bekräfta med dokumentation)
 
 | Endpoint | Metod | Beskrivning |
 |----------|-------|-------------|
 | `/api/sites` | GET | Lista byggnader |
 | `/api/sites/{id}` | GET | Byggnad med detaljer |
 | `/api/machines` | GET | Lista rum/utrustning |
 | `/api/machines/{id}` | GET | Rum/utrustning med sensorer |
 | `/api/sensors` | GET | Lista sensorer |
 | `/api/readings` | GET | Historiska mätvärden |
 | `/api/readings/aggregate` | GET | Aggregerade värden (avg, min, max) |
 
 ---
 
 ## Nästa steg
 
 1. **Verifiera API-endpoints**: Be användaren testa `/api/sensors` och `/api/readings` med befintliga credentials
 2. **Implementera hook**: Skapa `useSenslincData.ts`
 3. **Uppdatera Insights**: Byt ut mock-data stegvis
 4. **Testa Ilean-integration**: Verifiera att `ileanUrl` fungerar
 
 ---
 
 ## Frågor till användaren
 
 1. Vilka sensortyper är viktigast att visa först? (Temperatur, CO2, Energi?)
 2. Ska vi visa data för enskilda byggnader eller hela portfolion i Insights?
 3. Finns det specifika attributnamn i Asset+ för `ileanUrl` och `sensorUrl`?
 4. Vill du ha möjlighet att jämföra byggnader i samma diagram?