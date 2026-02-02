

# Plan: Senslinc IoT-integration

## Översikt

Integrera Senslinc (InUse/productinuse.com) för att hämta och visualisera IoT-sensordata i Geminus. Integrationen använder **FM GUID** som gemensam nyckel mellan Asset+ och Senslinc för att mappa byggnader, våningar, rum och tillgångar till Senslinc-equipment.

## API-analys

Baserat på den uppladdade API-dokumentationen:

**Autentisering:**
- JWT-baserad autentisering via `/api-token-auth/`
- Autentisering med email + password
- Token skickas med `Authorization: JWT {token}`

**Relevanta endpoints:**

| Endpoint | Beskrivning | Användning |
|----------|-------------|------------|
| `POST /api-token-auth/` | Hämta JWT-token | Autentisering |
| `GET /api/machines` | Lista equipment/maskiner | Rum, Assets |
| `GET /api/machines?code={fmGuid}` | Filtrera på kod (FM GUID) | Hitta specifikt equipment |
| `GET /api/lines` | Lista lines (våningsplan) | Våningar |
| `GET /api/sites` | Lista sites (byggnader) | Byggnader |
| `GET /api/producers` | Lista producers (portfolio) | Aggregerad data |

**Datamodell-mappning:**

```text
Asset+                    Senslinc
--------                  --------
Portfolio                 Manufacturer/Producer
Building (fmGuid)   -->   Site (code = fmGuid)
Building Storey     -->   Line (code = fmGuid)
Space (Room)        -->   Machine/Equipment (code = fmGuid)
Instance (Asset)    -->   Machine/Equipment (code = fmGuid)
```

---

## Fas 1: Dashboard-länkning (Lågt hängande frukt)

### 1.1 Aktivera IOT+-knappen för rum

När användaren klickar på IOT+ för ett rum/tillgång som har `sensorDashboard`-URL i attributen, öppna dashboarden.

**Filer att ändra:**
- `src/components/portfolio/PortfolioView.tsx` - Uppdatera `handleOpenIoT`
- `src/components/portfolio/FacilityLandingPage.tsx` - Extrahera sensor-URL från attributes
- `src/components/portfolio/QuickActions.tsx` - Aktivera IOT+-knappen med callback

**Logik:**
```typescript
const handleOpenIoT = (facility: Facility) => {
  const attrs = (facility as any).attributes || {};
  const dashboardKey = Object.keys(attrs).find(k => 
    k.toLowerCase().includes('sensordashboard') || 
    k.toLowerCase().includes('sensorurl')
  );
  
  if (dashboardKey && attrs[dashboardKey]?.value) {
    const savedConfigs = localStorage.getItem('appConfigs');
    const appConfigs = savedConfigs ? JSON.parse(savedConfigs) : {};
    const iotConfig = appConfigs.iot || { openMode: 'external' };
    
    if (iotConfig.openMode === 'internal') {
      openIoTDashboard(attrs[dashboardKey].value);
    } else {
      window.open(attrs[dashboardKey].value, '_blank');
    }
  } else {
    toast.info('Ingen IoT-dashboard', {
      description: 'Detta rum har ingen kopplad sensor-dashboard i Asset+.'
    });
  }
};
```

### 1.2 Skapa SenslincDashboardView komponent

Ny komponent för att visa Senslinc-dashboards i en intern iframe (likt Ivion360View).

**Ny fil:** `src/components/viewer/SenslincDashboardView.tsx`

---

## Fas 2: API-konfiguration med pollningsintervall

### 2.1 Uppdatera Senslinc-sektionen i inställningar

Ersätt "Kommer snart"-badge med faktisk konfiguration.

**Fil:** `src/components/settings/ApiSettingsModal.tsx`

Lägg till fält för:
- API URL (t.ex. `https://api.swg-group.productinuse.com`)
- Email (för autentisering)
- Password
- **Pollningsintervall** (dropdown med alternativ)

**UI för Senslinc-sektionen:**

```text
+--------------------------------------------------+
| Senslinc                        [Aktiv] badge    |
|--------------------------------------------------|
| Secrets konfigureras i Lovable Cloud             |
| (SENSLINC_API_URL, SENSLINC_EMAIL,               |
|  SENSLINC_PASSWORD)                              |
|                                                  |
| Pollningsintervall:                              |
| [ 24 timmar (rekommenderat)        v ]           |
|   Alternativ:                                    |
|   - 1 timme                                      |
|   - 6 timmar                                     |
|   - 12 timmar                                    |
|   - 24 timmar (rekommenderat)                    |
|   - 48 timmar                                    |
|   - Manuellt (ingen automatisk polling)          |
|                                                  |
| [ Testa anslutning ]  [ Hämta data nu ]          |
+--------------------------------------------------+
```

### 2.2 Uppdatera DEFAULT_APP_CONFIGS

**Fil:** `src/lib/constants.ts`

Lägg till `pollIntervalHours` i iot-konfigurationen:

```typescript
export const DEFAULT_APP_CONFIGS: Record<string, any> = {
  // ... existing configs ...
  iot: { 
    label: 'Sensor Dashboard', 
    url: 'https://swg-demo.bim.cloud/iot', 
    icon: Zap, 
    openMode: 'external', 
    username: '', 
    password: '',
    pollIntervalHours: 24  // Standard: 24 timmar
  },
  // ...
};
```

### 2.3 Pollningsintervall-alternativ

```typescript
const SENSLINC_POLL_OPTIONS = [
  { value: 1, label: '1 timme' },
  { value: 6, label: '6 timmar' },
  { value: 12, label: '12 timmar' },
  { value: 24, label: '24 timmar (rekommenderat)' },
  { value: 48, label: '48 timmar' },
  { value: 0, label: 'Manuellt (ingen automatisk polling)' },
];
```

**Secrets som behövs (läggs till i Lovable Cloud):**
- `SENSLINC_API_URL`
- `SENSLINC_EMAIL`
- `SENSLINC_PASSWORD`

---

## Fas 3: Edge Function för API-anrop

### 3.1 Skapa `senslinc-query` Edge Function

**Ny fil:** `supabase/functions/senslinc-query/index.ts`

**Actions som stöds:**
- `test-connection` - Testa autentisering
- `get-equipment` - Hämta equipment via FM GUID (code)
- `get-site-equipment` - Hämta alla equipment för en site/byggnad
- `sync-sensor-data` - Synka sensordata till lokal cache

```typescript
serve(async (req) => {
  const { action, fmGuid, siteCode } = await req.json();
  
  const apiUrl = Deno.env.get('SENSLINC_API_URL');
  const email = Deno.env.get('SENSLINC_EMAIL');
  const password = Deno.env.get('SENSLINC_PASSWORD');
  
  // Autentisera och hämta token
  const tokenRes = await fetch(`${apiUrl}/api-token-auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const { token } = await tokenRes.json();
  
  switch (action) {
    case 'test-connection':
      return Response.json({ success: true, message: 'Anslutning OK' });
      
    case 'get-equipment':
      const machinesRes = await fetch(
        `${apiUrl}/api/machines?code=${fmGuid}`,
        { headers: { Authorization: `JWT ${token}` } }
      );
      return Response.json(await machinesRes.json());
      
    case 'get-site-equipment':
      const siteRes = await fetch(
        `${apiUrl}/api/machines?site=${siteCode}`,
        { headers: { Authorization: `JWT ${token}` } }
      );
      return Response.json(await siteRes.json());
  }
});
```

---

## Fas 4: Frontend-hooks och services

### 4.1 Skapa `useSenslincEquipment` hook

**Ny fil:** `src/hooks/useSenslincEquipment.ts`

Hooken respekterar pollningsintervallet från inställningarna:

```typescript
export function useSenslincEquipment(fmGuid: string) {
  const [equipment, setEquipment] = useState<SenslincEquipment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  // Hämta pollningsintervall från appConfigs
  const savedConfigs = localStorage.getItem('appConfigs');
  const appConfigs = savedConfigs ? JSON.parse(savedConfigs) : {};
  const pollIntervalHours = appConfigs.iot?.pollIntervalHours ?? 24;
  const pollIntervalMs = pollIntervalHours * 60 * 60 * 1000;

  useEffect(() => {
    const fetchEquipment = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('senslinc-query', {
          body: { action: 'get-equipment', fmGuid }
        });
        if (error) throw error;
        setEquipment(data?.[0] || null);
        setLastFetched(new Date());
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };
    
    if (fmGuid) fetchEquipment();
    
    // Polling endast om pollIntervalHours > 0
    if (pollIntervalHours > 0) {
      const interval = setInterval(fetchEquipment, pollIntervalMs);
      return () => clearInterval(interval);
    }
  }, [fmGuid, pollIntervalHours]);

  return { equipment, isLoading, error, lastFetched };
}
```

---

## Fas 5: Insights-integration

### 5.1 Ny IoT-flik i InsightsView

**Fil att ändra:** `src/components/insights/InsightsView.tsx`
**Ny fil:** `src/components/insights/tabs/IoTManagementTab.tsx`

Visar:
- Realtids-KPI:er för temperatur, CO2, luftfuktighet, beläggning
- Lista över utrustning med sensorer
- Larmstatus och avvikelser
- Senaste synkroniseringstid baserat på pollningsintervall

### 5.2 Hierarkisk datamodell för Insights

```text
+-------------------------------------------------------------------+
|                        PORTFOLIO                                  |
|  Aggregerade KPI:er for alla byggnader                            |
|  - Genomsnittlig inomhustemperatur                                |
|  - CO2-nivaer over gransvardet                                    |
|  - Belaggningsgrad                                                |
+-------------------------------------------------------------------+
           |
           v
+-------------------------------------------------------------------+
|                        BYGGNAD                                    |
|  FM GUID --> Senslinc "Site" (code = fmGuid)                      |
|  - Temperaturkarta per vaning                                     |
|  - Inomhusklimat-index                                            |
+-------------------------------------------------------------------+
           |
           v
+-------------------------------------------------------------------+
|                        RUM (Space) / ASSET                        |
|  FM GUID --> Senslinc "Machine" (code = fmGuid)                   |
|  - Realtids-temperatur                                            |
|  - CO2-niva                                                       |
|  - Belaggningsstatus                                              |
+-------------------------------------------------------------------+
```

---

## Fas 6: Tandem-liknande 3D-visualisering

### 6.1 Förbättra RoomVisualizationPanel

**Fil:** `src/components/viewer/RoomVisualizationPanel.tsx`

- Lägg till option att hämta live-data från Senslinc istället för mock-data
- Visa "Live"-indikator med senaste uppdateringstid
- Data uppdateras enligt pollningsintervallet (standard 24h)

### 6.2 Förbättra IoTHoverLabel

**Fil:** `src/components/viewer/IoTHoverLabel.tsx`

- Visa senaste uppdateringstid
- Lägg till sparkline/trend-ikon
- Visa larmstatus om värde är utanför gränsvärden

---

## Filer som skapas/ändras

| Fil | Ändring |
|-----|---------|
| `src/lib/constants.ts` | Lägg till `pollIntervalHours: 24` i iot-config |
| `src/components/portfolio/PortfolioView.tsx` | Uppdatera `handleOpenIoT` |
| `src/components/portfolio/FacilityLandingPage.tsx` | Extrahera sensor-URL, skicka till QuickActions |
| `src/components/portfolio/QuickActions.tsx` | Aktivera IOT+-knappen med callback |
| `src/components/settings/ApiSettingsModal.tsx` | Ersätt "Kommer snart" med aktiv Senslinc-sektion inkl. pollningsintervall |
| `src/components/viewer/SenslincDashboardView.tsx` | **NY** - Iframe-vy för dashboards |
| `src/context/AppContext.tsx` | Lägg till `openIoTDashboard` context action |
| `src/components/layout/MainContent.tsx` | Rendera SenslincDashboardView |
| `supabase/functions/senslinc-query/index.ts` | **NY** - Edge function för API-anrop |
| `src/hooks/useSenslincEquipment.ts` | **NY** - Hook för att hämta equipment med konfigurerbar polling |
| `src/components/insights/tabs/IoTManagementTab.tsx` | **NY** - IoT-flik i Insights |

---

## Implementeringsordning

| Fas | Beskrivning | Komplexitet | Prioritet |
|-----|-------------|-------------|-----------|
| 1.1 | Aktivera IOT+-knapp med dashboard-URL fran Asset+ | Lag | Hog |
| 1.2 | SenslincDashboardView komponent | Lag | Hog |
| 2.1 | API-konfiguration med pollningsintervall i installningar | Medium | Hog |
| 3.1 | Edge function for Senslinc-anrop | Medium | Hog |
| 4.1 | useSenslincEquipment hook med konfigurerbar polling | Medium | Medium |
| 5.1 | IoT-flik i Insights | Hog | Medium |
| 6.1 | Live 3D-visualisering | Hog | Lag |

---

## Nasta steg

1. **Fas 1 forst**: Borja med att aktivera IOT+-knappen for rum som redan har dashboard-URL i Asset+
2. **Secrets**: Lagg till `SENSLINC_API_URL`, `SENSLINC_EMAIL`, `SENSLINC_PASSWORD` i Lovable Cloud
3. **Edge function**: Skapa `senslinc-query` for att hantera API-anrop

---

## Tekniska overvaganden

- **Token-caching**: JWT-token har begransad livstid, behover refreshas
- **Rate limiting**: Respektera Senslinc API:s begransningar
- **Felhantering**: Graceful degradering om Senslinc ar otillgangligt
- **FM GUID-mappning**: Anvander `code`-faltet i Senslinc for att matcha mot Asset+ fmGuid
- **Pollningsintervall**: Standard 24 timmar, konfigurerbart i installningar

