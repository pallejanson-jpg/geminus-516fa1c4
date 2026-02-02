
# Plan: Kontextbaserad 360+ Viewer med inventeringsverktyg

## Översikt

Gör 360+-viewern kontextbaserad så att när den startas från en byggnad, våning, rum eller asset så visas inventeringsverktygen (Registrera tillgång, Skapa POI från Geminus) i toolbaren. När 360+ öppnas från huvudmenyn/landningssidan (utan kontext) visas den som idag - utan dessa verktyg.

## Nuvarande flöde

```text
Portfolio → FacilityLandingPage → QuickActions → 360+ knappen
                                                       ↓
                                               handleOpen360(siteId)
                                                       ↓
                                          localStorage.setItem('ivion360Url', fullUrl)
                                                       ↓
                                               setActiveApp('radar')
                                                       ↓
                                          MainContent → Ivion360View (utan kontext)
```

**Problem:** Ivion360View får bara URL via localStorage, inte byggnadsinformation som behövs för inventeringsverktyg.

## Lösning: Skicka kontext via AppContext

### Del 1: Utöka AppContext med 360-kontext

Lägg till nytt state för att hålla 360-kontexten:

```typescript
// I AppContext.tsx
interface Ivion360Context {
  buildingFmGuid: string;
  buildingName?: string;
  ivionSiteId: string;
  ivionUrl: string;
}

// Nytt state
ivion360Context: Ivion360Context | null;
setIvion360Context: (context: Ivion360Context | null) => void;
open360WithContext: (context: Ivion360Context) => void;
```

### Del 2: Uppdatera handleOpen360 i PortfolioView

Spara kontext istället för bara URL:

```typescript
const handleOpen360 = (siteId?: string) => {
  if (siteId && selectedFacility) {
    const fullUrl = `${baseUrl}/?site=${siteId}`;
    
    if (ivionConfig.openMode === 'internal') {
      // NYTT: Spara kontext i AppContext
      open360WithContext({
        buildingFmGuid: selectedFacility.fmGuid || selectedFacility.buildingFmGuid,
        buildingName: selectedFacility.commonName || selectedFacility.name,
        ivionSiteId: siteId,
        ivionUrl: fullUrl,
      });
    } else {
      window.open(fullUrl, '_blank');
    }
  } else {
    // Ingen kontext - öppna som vanligt
    setActiveApp('radar');
  }
};
```

### Del 3: Uppdatera Ivion360View med inventeringsverktyg

Lägg till verktygsknapparna och paneler när kontext finns:

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ 360° Viewer - Kv. Aurora                                                  │
│                        [📍 Registrera] [📦 POI från Geminus] [↗] [□] [X]  │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│   ┌──────────────────┐                                                   │
│   │ Ivion Iframe     │  ┌─────────────────────────────────┐              │
│   │                  │  │ IvionRegistrationPanel          │              │
│   │ (360° panorama)  │  │ (draggbar, öppnas vid klick     │              │
│   │                  │  │  eller automatiskt vid ny POI)  │              │
│   │                  │  └─────────────────────────────────┘              │
│   │                  │                                                   │
│   │                  │  ┌─────────────────────────────────┐              │
│   │                  │  │ UnplacedAssetsPanel             │              │
│   │                  │  │ (draggbar, öppnas vid klick)    │              │
│   └──────────────────┘  └─────────────────────────────────┘              │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

### Del 4: POI-polling (återanvänd logik från IvionInventory)

När registreringspanelen är öppen, polla efter nya POI:er:

```typescript
// Polling varje 3 sekunder
useEffect(() => {
  if (!ivionSiteId || !formOpen) return;
  
  const poll = async () => {
    const { data } = await supabase.functions.invoke('ivion-poi', {
      body: { action: 'get-latest-poi', siteId: ivionSiteId },
    });
    
    if (data?.id && data.id !== lastSeenPoiId) {
      setDetectedPoi(data);
      toast.info('Ny POI upptäckt!');
    }
    setLastSeenPoiId(data?.id ?? null);
  };
  
  const interval = setInterval(poll, 3000);
  return () => clearInterval(interval);
}, [ivionSiteId, formOpen, lastSeenPoiId]);
```

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/context/AppContext.tsx` | Lägg till `ivion360Context` state och `open360WithContext` action |
| `src/components/portfolio/PortfolioView.tsx` | Uppdatera `handleOpen360` att använda `open360WithContext` med byggnadsinfo |
| `src/components/viewer/Ivion360View.tsx` | Läsa kontext från AppContext, visa inventeringsverktyg när kontext finns, integrera paneler |
| `src/components/layout/MainContent.tsx` | Rensa `ivion360Context` vid stängning av 360-vyn |

## Flödesdiagram

```text
┌─────────────────────────────────────────────────────────────────┐
│                        FRÅN BYGGNAD                             │
│                                                                 │
│  QuickActions → handleOpen360(siteId)                          │
│                       ↓                                         │
│            open360WithContext({                                 │
│              buildingFmGuid: "...",                            │
│              buildingName: "Kv. Aurora",                        │
│              ivionSiteId: "123",                               │
│              ivionUrl: "https://..."                           │
│            })                                                   │
│                       ↓                                         │
│            setActiveApp('radar')                                │
│                       ↓                                         │
│     Ivion360View läser kontext → VISAR VERKTYG                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      FRÅN HUVUDMENYN                            │
│                                                                 │
│  Sidebar → setActiveApp('radar')                               │
│                       ↓                                         │
│     Ivion360View: context = null → INGA VERKTYG                │
│     (visar "Configure Ivion Site ID" meddelande)               │
└─────────────────────────────────────────────────────────────────┘
```

## Testning

1. **Öppna 360+ från en byggnad** → Verktygsknappar ska visas i headern
2. **Öppna 360+ från huvudmenyn** → Inga extra verktyg, visas som vanligt
3. **Klicka "Registrera tillgång"** → IvionRegistrationPanel öppnas som draggbar overlay
4. **Klicka "POI från Geminus"** → UnplacedAssetsPanel öppnas
5. **Skapa en POI i Ivion** → Panel uppdateras automatiskt med koordinater
6. **Stäng 360+** → Återgå till Portfolio, kontext rensas
