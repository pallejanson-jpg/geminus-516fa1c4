
# Plan: Bi-directional Ivion POI-integration

## Sammanfattning

Implementera en fullständig tvåvägs-synkronisering mellan Lovable (Geminus) och NavVis Ivion:

1. **Ivion -> Lovable**: När POI skapas i Ivion ska Lovable's registreringspanel automatiskt öppnas med POI-data
2. **Lovable -> Ivion**: Befintliga assets utan Ivion-position ska kunna skapas som POIs i Ivion
3. **FMGUID-koppling**: Alla POIs ska ha FMGUID i "Custom attributes" för att koppla systemen

---

## Del 1: Automatisk detektion av nya POIs (Ivion -> Lovable)

Eftersom Ivion körs i en cross-origin iframe kan vi inte lyssna på deras events direkt. Lösningen är **polling** - regelbundet kontrollera om nya POIs har skapats.

### Ny funktionalitet i IvionInventory.tsx

```typescript
// Poll for new POIs every 3 seconds when the iframe is visible
const [lastSeenPoiId, setLastSeenPoiId] = useState<number | null>(null);
const [pollingEnabled, setPollingEnabled] = useState(true);

useEffect(() => {
  if (!ivionSiteId || !pollingEnabled) return;
  
  const pollInterval = setInterval(async () => {
    const { data } = await supabase.functions.invoke('ivion-poi', {
      body: { action: 'get-latest-poi', siteId: ivionSiteId }
    });
    
    if (data?.id && data.id !== lastSeenPoiId) {
      // New POI detected!
      setLastSeenPoiId(data.id);
      
      // Auto-open registration panel with POI data pre-filled
      setFormOpen(true);
      setAutoFilledPoi(data);
    }
  }, 3000);
  
  return () => clearInterval(pollInterval);
}, [ivionSiteId, lastSeenPoiId, pollingEnabled]);
```

### Uppdatera IvionRegistrationPanel

- Acceptera ny prop `initialPoi` med förfylld POI-data
- Automatiskt fylla i namn, koordinater och POI-ID från den nya POIn

---

## Del 2: Skapa POIs i Ivion från befintliga assets (Lovable -> Ivion)

### Ny komponent: UnplacedAssetsPanel.tsx

En ny panel som visar assets utan Ivion-position och låter användaren:
1. Välja en eller flera assets
2. Klicka i Ivion-vyn för att ange position
3. Skapa POIs för alla valda assets på den positionen

```text
┌─────────────────────────────────┐
│ Skapa POI från Geminus   [×]    │
├─────────────────────────────────┤
│ 🔍 Sök assets...                │
├─────────────────────────────────┤
│ ☐ Brandsläckare BS-001          │
│ ☐ Utrymningstavla UT-003        │
│ ☑ Nöddusch ND-002               │
│ ☑ Ögondusch ÖD-001              │
├─────────────────────────────────┤
│ 2 valda                         │
│ [Klicka i Ivion för position]   │
└─────────────────────────────────┘
```

### Edge function: Uppdatera create-poi för att inkludera FMGUID

Redan implementerat i `syncAssetToPoi` - funktionen skapar POI med `customData: JSON.stringify({ fm_guid: asset.fm_guid, ... })`.

Men vi behöver också använda **Custom attributes** i Ivion (som i referensbilden med "FMGUID"-fältet). Detta kräver att vi uppdaterar POI-skapandet:

```typescript
const poiData: Partial<IvionPoi> = {
  titles: { sv: asset.name },
  location: { x, y, z },
  customData: JSON.stringify({
    FMGUID: asset.fm_guid,  // Key matchar Ivion's custom attribute
    asset_type: asset.asset_type,
    source: 'geminus',
  }),
  // customAttributes är ett alternativt format som vissa Ivion-versioner använder
};
```

---

## Del 3: FMGUID-generering och synkronisering

### Vid POI-skapande i Ivion (manuellt)

1. När användaren skapar POI i Ivion och sparar
2. Lovable's polling detekterar den nya POIn
3. Registreringspanelen öppnas automatiskt
4. Användaren fyller i kategori/symbol och sparar
5. **Ny FMGUID genereras av Lovable** (`crypto.randomUUID()`)
6. **FMGUID skrivs tillbaka till Ivion via API-anrop** (update POI)

### Ny edge function action: update-poi

```typescript
case 'update-poi':
  if (!params.siteId || !params.poiId || !params.poiData) {
    throw new Error('siteId, poiId and poiData required');
  }
  result = await updatePoi(params.siteId, params.poiId, params.poiData);
  break;
```

```typescript
async function updatePoi(siteId: string, poiId: number, updates: Partial<IvionPoi>): Promise<IvionPoi> {
  const token = await getIvionToken();
  
  // Hämta befintlig POI först
  const existing = await getPoi(siteId, poiId);
  
  // Merge custom data för att bevara befintliga attribut
  let customData = {};
  try { customData = JSON.parse(existing.customData || '{}'); } catch {}
  
  const newCustomData = JSON.parse(updates.customData || '{}');
  const mergedCustomData = { ...customData, ...newCustomData };
  
  const response = await fetch(`${IVION_API_URL}/api/site/${siteId}/pois/${poiId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...existing,
      ...updates,
      customData: JSON.stringify(mergedCustomData),
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to update POI: ${response.status}`);
  }
  
  return response.json();
}
```

---

## Del 4: UI-layout med ny knapp

### Uppdaterad header i IvionInventory.tsx

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ [←] [Byggnad: Centralstationen ▼]     [Skapa POI från Geminus] [Registrera] │
└─────────────────────────────────────────────────────────────────────────────┘
```

Två knappar bredvid varandra:
- **"Skapa POI från Geminus"** - Öppnar listan med assets utan position
- **"Registrera tillgång"** - Befintlig knapp för att registrera ny asset

---

## Filer att skapa/ändra

| Fil | Ändringar |
|-----|-----------|
| `src/pages/IvionInventory.tsx` | Lägg till polling, ny knapp, hantera auto-fill |
| `src/components/inventory/IvionRegistrationPanel.tsx` | Acceptera `initialPoi` prop, skriv FMGUID till Ivion vid sparande |
| `src/components/inventory/UnplacedAssetsPanel.tsx` | **NY** - Panel för att visa/välja assets utan position |
| `supabase/functions/ivion-poi/index.ts` | Lägg till `update-poi` action |

---

## Teknisk notering: Cross-origin begränsningar

Eftersom Ivion är externt hostad (swg.iv.navvis.com) kan vi INTE:
- Injicera JavaScript i deras iframe
- Lyssna på deras DOM-events (t.ex. "onPoiSave")
- Kommunicera via postMessage utan att NavVis konfigurerar det

Polling är därför den enda realistiska lösningen. Alternativet kräver att NavVis aktiverar ett "Custom Plugin" på deras sida som skickar postMessage till parent-fönstret.

---

## Flödesdiagram

```text
┌──────────────────────────────────────────────────────────────────┐
│                     IVION -> LOVABLE                             │
│                                                                  │
│  [Användare skapar POI i Ivion]                                  │
│         │                                                        │
│         ▼                                                        │
│  [Polling detekterar ny POI (var 3:e sek)]                       │
│         │                                                        │
│         ▼                                                        │
│  [Registreringspanel öppnas automatiskt]                         │
│  [Namn + koordinater förfyllda]                                  │
│         │                                                        │
│         ▼                                                        │
│  [Användare väljer kategori/symbol och sparar]                   │
│         │                                                        │
│         ▼                                                        │
│  [Asset skapas i Lovable med ny FMGUID]                          │
│         │                                                        │
│         ▼                                                        │
│  [FMGUID skrivs tillbaka till Ivion POI:s custom attributes]     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                     LOVABLE -> IVION                             │
│                                                                  │
│  [Användare klickar "Skapa POI från Geminus"]                    │
│         │                                                        │
│         ▼                                                        │
│  [Lista visas med assets utan Ivion-position]                    │
│         │                                                        │
│         ▼                                                        │
│  [Användare väljer en eller flera assets]                        │
│         │                                                        │
│         ▼                                                        │
│  [Användare klickar plats i Ivion-vyn]                           │
│         │                                                        │
│         ▼                                                        │
│  [POIs skapas via API med FMGUID i custom attributes]            │
│         │                                                        │
│         ▼                                                        │
│  [Assets uppdateras med ivion_poi_id]                            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Beroenden och förutsättningar

1. **Ivion API-autentisering måste fungera** - Antingen via username/password eller IVION_ACCESS_TOKEN
2. **Ivion API måste stödja PUT för POI-uppdatering** - Behöver verifieras mot NavVis dokumentation
3. **Polling kan påverka prestanda** - 3 sekunders intervall är en balans mellan responsivitet och API-belastning

---

## Alternativ om API-autentisering inte fungerar

Om Ivion-API:et fortsätter att returnera 403:

1. **Manuellt läge**: Användaren kopierar POI-ID manuellt från Ivion-URL:en
2. **Webhook-integration**: Kontakta NavVis för att konfigurera webhook som anropar en Lovable endpoint vid POI-skapande
3. **NavVis Custom Plugin**: Kräver admin-access till NavVis-kontot för att konfigurera postMessage-kommunikation
