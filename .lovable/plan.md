
# Plan: Implementera Ivion 360+ Position-picking Workflow

## Problemanalys

NavVis Ivion stöder **inte** direkt kommunikation via postMessage till inbäddade iframes. Deras API är designat för:
1. **REST API** - Server-to-server kommunikation för CRUD av POIs
2. **Frontend NPM-paket** - Fullständig JavaScript-integration (kräver att Ivion hostas i din app, inte tvärtom)
3. **Standalone webläsare** - Ivion som egen applikation

## Rekommenderad lösning: Tvåstegs-workflow

Eftersom direkt klick-till-koordinat-callback inte är möjligt, föreslår jag en **asynkron workflow**:

### Steg 1: Skapa POI i Ivion
- Användaren klickar "360+" i inventeringsformuläret
- Ivion öppnas (inline eller ny flik)
- Användaren **long-press** på positionen i panoramat → Ivion skapar POI
- Användaren anger namn i Ivion (kan vara samma som i Lovable)
- Ivion sparar POI till sin databas

### Steg 2: Importera/synka POI till Lovable
- Användaren klickar "Synka från 360+" knapp i inventeringsformuläret
- Lovable anropar `ivion-poi` edge function med action `import-pois`
- Edge function hämtar alla POIs från Ivion site och importerar till `assets` tabellen
- Nya POIs matchas med assets baserat på namn eller skapas som nya assets

### Alternativ: Manuell POI-ID input
- Efter att användaren skapat POI i Ivion, kopierar de POI-ID:t
- I Lovable klistrar de in POI-ID
- Lovable hämtar POI-data och uppdaterar asset med koordinater

---

## Detaljerad implementation

### Del 1: Uppdatera InventoryForm med "Synka från 360+"

Lägg till en knapp som triggar import av POIs:

```typescript
// I InventoryForm.tsx
const [isSyncing360, setIsSyncing360] = useState(false);

const handleSync360 = async () => {
  if (!buildingSettings?.ivion_site_id || !buildingFmGuid) {
    toast.error('Ivion ej konfigurerat för denna byggnad');
    return;
  }
  
  setIsSyncing360(true);
  try {
    const { data, error } = await supabase.functions.invoke('ivion-poi', {
      body: {
        action: 'import-pois',
        siteId: buildingSettings.ivion_site_id,
        buildingFmGuid: buildingFmGuid,
      }
    });
    
    if (error) throw error;
    toast.success(`Synkade ${data.imported} nya POIs från Ivion`);
  } catch (err: any) {
    toast.error('Kunde inte synka', { description: err.message });
  } finally {
    setIsSyncing360(false);
  }
};
```

### Del 2: Förbättra UI för 360+ flödet

Visa tydlig instruktion för användaren:

```jsx
{/* 360+ Position section */}
<div className="space-y-3">
  <Label className="flex items-center gap-2">
    <Eye size={14} />
    360+ Position
  </Label>
  
  <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
    <p className="font-medium mb-1">Så här sätter du position i 360+:</p>
    <ol className="list-decimal list-inside space-y-1">
      <li>Klicka "Öppna 360+" för att starta Ivion</li>
      <li>Navigera till rätt plats i panoramat</li>
      <li>Long-press för att skapa en POI</li>
      <li>Klicka "Synka från 360+" för att importera</li>
    </ol>
  </div>
  
  <div className="flex gap-2">
    <Button variant="outline" onClick={handleOpen360} className="flex-1">
      <Eye className="h-4 w-4 mr-2" />
      Öppna 360+
    </Button>
    <Button 
      variant="outline" 
      onClick={handleSync360} 
      disabled={isSyncing360}
      className="flex-1"
    >
      {isSyncing360 ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
      Synka från 360+
    </Button>
  </div>
</div>
```

### Del 3: Förbättra edge function för smartare import

Uppdatera `ivion-poi/index.ts` för att stödja import av enskilda POIs:

```typescript
// Ny action: get-poi för att hämta specifik POI
case 'get-poi':
  if (!params.siteId || !params.poiId) throw new Error('siteId and poiId required');
  result = await getPoi(params.siteId, params.poiId);
  break;

// Funktion för att hämta enskild POI
async function getPoi(siteId: string, poiId: number): Promise<IvionPoi> {
  const token = await getIvionToken();
  const response = await fetch(`${IVION_API_URL}/api/site/${siteId}/pois/${poiId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Failed to get POI: ${response.status}`);
  return response.json();
}
```

---

## Filändringar

| Fil | Ändring |
|-----|---------|
| `src/components/inventory/InventoryForm.tsx` | Lägg till "Synka från 360+" knapp och instruktioner |
| `supabase/functions/ivion-poi/index.ts` | Lägg till `get-poi` action för enskilda POIs |
| `src/pages/Inventory.tsx` | Uppdatera UI för att visa synk-status |

---

## Alternativ förbättring: POI-ID input

Om användaren vill koppla till en specifik POI manuellt:

```jsx
<div className="flex gap-2">
  <Input
    placeholder="POI-ID från Ivion"
    value={manualPoiId}
    onChange={(e) => setManualPoiId(e.target.value)}
    className="flex-1"
  />
  <Button onClick={handleLinkPoi} disabled={!manualPoiId}>
    Koppla
  </Button>
</div>
```

---

## Framtida förbättringar

Om NavVis lägger till webhook-stöd eller postMessage-API i framtiden kan vi implementera:

1. **Webhook callback**: Ivion → Lovable edge function när POI skapas
2. **Real-time sync**: Supabase Realtime för att visa nya POIs direkt
3. **Embed med SDK**: Använda NavVis NPM-paket för fullständig kontroll

---

## Sammanfattning

Eftersom Ivion inte stöder direkt iframe-kommunikation, implementerar vi en asynkron workflow där:
1. Användaren skapar POI i Ivion
2. Lovable importerar POIs on-demand via befintlig edge function
3. Assets kopplas till POIs baserat på matchning eller manuell koppling

Detta är en pragmatisk lösning som fungerar med Ivions nuvarande arkitektur.
