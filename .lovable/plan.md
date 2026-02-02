

# Plan: Welcome-text, Ilean-assistent och förbättrad Senslinc-integration

## Översikt

Denna plan omfattar fyra delar:
1. Ändra välkomsttext från "Welcome to My SWG" till "Welcome to My Geminus"
2. Implementera Ilean-assistent (från Senslinc) med samma funktionalitet som Gunnar
3. Ändra IOT+ till internt läge som standard (iframe istället för ny flik)
4. Hämta IOT+ dashboard-URL via Senslinc API för byggnader och våningar som saknar URL i Asset+

---

## Del 1: Välkomsttext

**Fil att ändra:** `src/components/home/HomeLanding.tsx`

Rad 121: Ändra texten till:
```typescript
<h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight">Welcome to My Geminus</h1>
```

---

## Del 2: Ilean-assistent

Ilean ska fungera som Gunnar - en flyttbar, flytande AI-assistent som följer med genom hela applikationen. Skillnaden är att Ilean hämtas från Senslinc och kan vara kopplad till specifika objekt via "Ilean URL" i Asset+.

### 2.1 Inställningar för Ilean

**Ny fil:** `src/components/settings/IleanSettings.tsx`

```text
+--------------------------------------------------+
| Ilean AI                                         |
| Dokumentassistent från Senslinc                  |
+--------------------------------------------------+
| Visa Ilean-knappen              [  Toggle  ]     |
|                                                  |
| Knappposition                                    |
| Anpassad position (x, y)        [ Återställ ]   |
+--------------------------------------------------+
| Tips: Du kan dra Ilean-knappen till valfri       |
| position på skärmen.                             |
+--------------------------------------------------+
```

Baserad på GunnarSettings.tsx med:
- `ILEAN_SETTINGS_KEY = 'ilean-settings'`
- `ILEAN_SETTINGS_CHANGED_EVENT = 'ilean-settings-changed'`
- `IleanSettingsData { visible: boolean; buttonPosition: { x, y } | null }`

### 2.2 Ilean-knapp (flyttbar)

**Ny fil:** `src/components/chat/IleanButton.tsx`

Baserad på GunnarButton.tsx med:
- Flyttbar trigger-knapp med position-sparning i localStorage
- Flyttbar panel med frostad-glas-effekt
- Iframe-innehåll som hämtar Ilean från:
  1. **Primärt**: URL från Asset+-attribut (t.ex. "ileanUrl" eller "ilean_url")
  2. **Fallback**: Generell Ilean-URL via Senslinc API

Panelens struktur:
```text
+---------------------------------------+
| [Grip] Ilean AI           [-] [X]     |
+---------------------------------------+
|                                       |
|   Ilean iframe (från Senslinc)       |
|   eller felmeddelande om ej config   |
|                                       |
+---------------------------------------+
```

### 2.3 Lägg till Ilean i AppLayout

**Fil:** `src/components/layout/AppLayout.tsx`

```typescript
import { getIleanSettings, ILEAN_SETTINGS_CHANGED_EVENT } from '@/components/settings/IleanSettings';
import IleanButton from '@/components/chat/IleanButton';

// Lägg till state
const [ileanVisible, setIleanVisible] = useState(() => getIleanSettings().visible);

// Lägg till useEffect för att lyssna på settings-ändringar
useEffect(() => {
    const handleIleanSettingsChange = (e: CustomEvent) => {
        setIleanVisible(e.detail?.visible ?? true);
    };
    window.addEventListener(ILEAN_SETTINGS_CHANGED_EVENT, handleIleanSettingsChange as EventListener);
    return () => window.removeEventListener(ILEAN_SETTINGS_CHANGED_EVENT, handleIleanSettingsChange as EventListener);
}, []);

// Rendera knappen
{ileanVisible && <IleanButton />}
```

### 2.4 Lägg till Ilean-inställningar i ProfileModal

**Fil:** `src/components/settings/ProfileModal.tsx`

Lägg till en tabbed-vy eller expanderbar sektion för assistentinställningar:

```text
+--------------------------------------------------+
| Profil                                           |
+--------------------------------------------------+
| [ Profil ] [ AI-assistenter ]                    |
+--------------------------------------------------+
|                                                  |
| Gunnar AI                                        |
| [GunnarSettings komponent]                       |
|                                                  |
| Ilean AI                                         |
| [IleanSettings komponent]                        |
|                                                  |
+--------------------------------------------------+
```

### 2.5 Aktivera Ilean i HomeLanding

**Fil:** `src/components/home/HomeLanding.tsx`

Ändra `available: false` till `available: true` för Ilean i ASSISTANTS-arrayen.

---

## Del 3: IOT+ internt läge som standard

### 3.1 Ändra standardvärde

**Fil:** `src/lib/constants.ts`

Rad 69: Ändra `openMode` från `'external'` till `'internal'`:
```typescript
iot: { label: 'Sensor Dashboard', url: 'https://swg-demo.bim.cloud/iot', icon: Zap, openMode: 'internal', username: '', password: '', pollIntervalHours: 24 },
```

### 3.2 Förbättra SenslincDashboardView styling

**Fil:** `src/components/viewer/SenslincDashboardView.tsx`

Förbättra styling för att bättre matcha Geminus tema:
- Använd theme-variabler för färger
- Lägg till loading-indikator medan iframe laddas
- Förbättra header-styling

---

## Del 4: Hämta IOT+ URL via Senslinc API

### 4.1 Utöka senslinc-query Edge Function

**Fil:** `supabase/functions/senslinc-query/index.ts`

Lägg till ny action `get-dashboard-url`:
```typescript
case 'get-dashboard-url': {
  if (!fmGuid) {
    return new Response(
      JSON.stringify({ success: false, error: 'fmGuid required' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
  
  const token = await getJwtToken(cleanApiUrl, email, password);
  
  // Försök hitta som machine först (rum/asset)
  const machines = await senslincFetch(cleanApiUrl, `/api/machines?code=${encodeURIComponent(fmGuid)}`, token);
  if (Array.isArray(machines) && machines.length > 0) {
    const machine = machines[0];
    // Bygg dashboard-URL baserat på machine-data
    const dashboardUrl = machine.dashboard_url || `${cleanApiUrl.replace('/api', '')}/dashboard/machine/${machine.pk}`;
    return new Response(
      JSON.stringify({ success: true, data: { dashboardUrl, type: 'machine', ...machine } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Försök hitta som site (byggnad)
  const sites = await senslincFetch(cleanApiUrl, `/api/sites?code=${encodeURIComponent(fmGuid)}`, token);
  if (Array.isArray(sites) && sites.length > 0) {
    const site = sites[0];
    const dashboardUrl = site.dashboard_url || `${cleanApiUrl.replace('/api', '')}/dashboard/site/${site.pk}`;
    return new Response(
      JSON.stringify({ success: true, data: { dashboardUrl, type: 'site', ...site } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Försök hitta som line (våningsplan)
  const lines = await senslincFetch(cleanApiUrl, `/api/lines?code=${encodeURIComponent(fmGuid)}`, token);
  if (Array.isArray(lines) && lines.length > 0) {
    const line = lines[0];
    const dashboardUrl = line.dashboard_url || `${cleanApiUrl.replace('/api', '')}/dashboard/line/${line.pk}`;
    return new Response(
      JSON.stringify({ success: true, data: { dashboardUrl, type: 'line', ...line } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  return new Response(
    JSON.stringify({ success: false, error: 'No equipment found for this FM GUID' }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
```

### 4.2 Uppdatera handleOpenIoT i PortfolioView

**Fil:** `src/components/portfolio/PortfolioView.tsx`

Förbättra `handleOpenIoT` för att falla tillbaka till Senslinc API:
```typescript
const handleOpenIoT = async (facility: Facility) => {
  const attrs = (facility as any).attributes || {};
  
  // Försök hitta dashboard-URL i attribut
  const dashboardKey = Object.keys(attrs).find(k => 
    k.toLowerCase().includes('sensordashboard') || 
    k.toLowerCase().includes('sensorurl')
  );
  
  let dashboardUrl = dashboardKey ? attrs[dashboardKey]?.value : null;
  
  // Om ingen URL finns i attribut, försök hämta från Senslinc API
  if (!dashboardUrl && facility.fmGuid) {
    try {
      const { data, error } = await supabase.functions.invoke('senslinc-query', {
        body: { action: 'get-dashboard-url', fmGuid: facility.fmGuid }
      });
      if (data?.success && data?.data?.dashboardUrl) {
        dashboardUrl = data.data.dashboardUrl;
      }
    } catch (err) {
      console.log('[IoT] Failed to fetch dashboard URL from Senslinc:', err);
    }
  }
  
  if (dashboardUrl) {
    const iotConfig = appConfigs.iot || { openMode: 'internal' };
    
    if (iotConfig.openMode === 'internal') {
      openSenslincDashboard({
        dashboardUrl,
        facilityName: facility.commonName || facility.name || 'IoT Dashboard',
        facilityFmGuid: facility.fmGuid,
      });
    } else {
      window.open(dashboardUrl, '_blank');
    }
  } else {
    toast.info('Ingen IoT-dashboard', {
      description: 'Detta objekt har ingen kopplad sensor-dashboard.'
    });
  }
};
```

---

## Filer som skapas/ändras

| Fil | Typ | Beskrivning |
|-----|-----|-------------|
| `src/components/home/HomeLanding.tsx` | Ändra | Välkomsttext + aktivera Ilean |
| `src/components/settings/IleanSettings.tsx` | **NY** | Inställningar för Ilean-knappen |
| `src/components/chat/IleanButton.tsx` | **NY** | Flyttbar Ilean-assistent |
| `src/components/layout/AppLayout.tsx` | Ändra | Lägg till Ilean-knapp |
| `src/components/settings/ProfileModal.tsx` | Ändra | Lägg till assistentinställningar |
| `src/lib/constants.ts` | Ändra | IOT openMode till 'internal' |
| `src/components/viewer/SenslincDashboardView.tsx` | Ändra | Förbättrad styling |
| `supabase/functions/senslinc-query/index.ts` | Ändra | Lägg till get-dashboard-url action |
| `src/components/portfolio/PortfolioView.tsx` | Ändra | Fallback till Senslinc API |

---

## Tekniska överväganden

### Ilean URL-källa
1. **Primärt**: Sök efter attribut som innehåller "ilean" i namn (ileanUrl, ilean_url, ileanDashboard, etc.)
2. **Fallback**: Fråga Senslinc API med objektets FM GUID
3. **Global**: Om inget objektspecifikt finns, visa generell Ilean-portal

### Temastyrning för iframes
Tyvärr kan vi inte direkt styra färger inuti iframes från externa domäner (productinuse.com) pga. cross-origin-begränsningar. Däremot kan vi:
- Styla header/footer/ramverk runt iframe med Geminus tema
- Använda backdrop-blur och theme-färger på container-element
- Visa loading-state och error-state i Geminus-stil

---

## Implementeringsordning

1. **Välkomsttext** - Snabb ändring
2. **IOT internt läge** - Ändra standardvärde i constants.ts
3. **Ilean Settings + Button** - Skapa nya komponenter baserade på Gunnar
4. **AppLayout + ProfileModal** - Integrera Ilean
5. **Senslinc API get-dashboard-url** - Edge function uppdatering
6. **PortfolioView fallback** - Hämta URL från API om ej i Asset+

