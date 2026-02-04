
# Plan: Koordinat-baserad Split View-synk via postMessage

## Problemanalys

Efter grundlig undersökning har jag identifierat rotorsaken:

| Komponent | Status | Problem |
|-----------|--------|---------|
| Ivion-autentisering | ✅ Fungerar | `SWG_PalJ` bekräftat |
| Backend-API för bilder | ❌ Begränsat | Endast 2 av 17 datasets söks, returnerar tom lista |
| postMessage-lyssnare | ⚠️ Ofullständig | Extraherar endast `imageId`, ignorerar `position` |
| Koordinatsystem | ✅ Kompatibelt | Ivion och xeokit använder samma lokala meter-system |

**Huvudinsikt**: Ivion skickar redan `position: {x, y, z}` i lokala meter direkt i `camera-changed`-händelser! Vi behöver inte geo-koordinater eller backend-API alls för synkronisering.

## Lösning: Direktsynk via postMessage

```text
┌─────────────────────────────────────────────────────────────┐
│  NUVARANDE FLÖDE (trasigt)                                  │
├─────────────────────────────────────────────────────────────┤
│  Ivion postMessage → extrahera imageId → anropa backend     │
│  → hämta koordinater → uppdatera 3D                         │
│                          ↑                                  │
│                    Backend returnerar tom lista!            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  NYTT FLÖDE (direkt)                                        │
├─────────────────────────────────────────────────────────────┤
│  Ivion postMessage → extrahera position {x,y,z} direkt      │
│  → uppdatera 3D viewer                                      │
│                                                             │
│  ⚡ Ingen backend-anrop behövs!                              │
│  ⚡ Realtidssynk utan fördröjning!                           │
└─────────────────────────────────────────────────────────────┘
```

## Teknisk implementation

### Steg 1: Uppdatera postMessage-lyssnaren

**Fil: `src/hooks/useIvionCameraSync.ts`**

Modifiera `handleMessage` för att extrahera position direkt:

```typescript
// I handleMessage (cirka rad 184-195):
if (data.event === 'camera-changed' || data.event === 'image-changed') {
  const eventData = data.data || {};
  
  // NYTT: Extrahera position direkt om tillgänglig
  const directPosition = eventData.position || eventData.location;
  if (directPosition && directPosition.x !== undefined) {
    const position: LocalCoords = {
      x: directPosition.x,
      y: directPosition.y,
      z: directPosition.z,
    };
    
    // Konvertera heading/pitch från radianer om nödvändigt
    const headingRad = eventData.yaw ?? eventData.heading ?? 0;
    const pitchRad = eventData.pitch ?? 0;
    const heading = Math.abs(headingRad) > Math.PI * 2 ? headingRad : headingRad * (180 / Math.PI);
    const pitch = Math.abs(pitchRad) > Math.PI * 2 ? pitchRad : pitchRad * (180 / Math.PI);
    
    console.log('[Ivion Sync] Direct position from postMessage:', position);
    updateFromIvion(position, heading, pitch);
    setCurrentImageId(eventData.imageId || null);
    setLastSyncSource('ivion');
    return; // Skippa backend-anrop
  }
  
  // Fallback till imageId-baserad synk om position saknas
  const imageId = eventData.imageId || eventData.image;
  if (imageId && imageId !== lastSyncedImageIdRef.current) {
    await handleIvionImageChange(imageId, heading, pitch);
  }
}
```

### Steg 2: Lägg till NavVis PointOfViewInterface-stöd

**Fil: `src/hooks/useIvionCameraSync.ts`**

Skicka `subscribe`-kommando för att aktivera POV-events:

```typescript
// I sendSubscribeCommand:
const subscribeCommands = [
  // Befintliga kommandon...
  
  // NYTT: PointOfViewInterface subscription
  { type: 'navvis-subscribe', action: 'pointOfView', events: ['change'] },
  { type: 'ivion-subscribe', events: ['pov-changed', 'camera-changed'] },
];
```

### Steg 3: Hantera 3D → 360° synk via postMessage

**Fil: `src/hooks/useIvionCameraSync.ts`**

I `syncToIvion`, skicka `moveToLocation`-kommando istället för att ändra URL:

```typescript
// I syncToIvion (cirka rad 298-356):
// Försök postMessage först
if (iframeRef.current?.contentWindow) {
  const moveCommand = {
    type: 'navvis-command',
    action: 'moveToLocation',
    params: {
      position: {
        x: syncState.position.x,
        y: syncState.position.y,
        z: syncState.position.z,
      },
      heading: (syncState.heading * Math.PI) / 180, // Till radianer
      pitch: (syncState.pitch * Math.PI) / 180,
    },
  };
  
  iframeRef.current.contentWindow.postMessage(moveCommand, '*');
  console.log('[Ivion Sync] Sent moveToLocation via postMessage');
  
  // Fallback till URL-ändring om postMessage inte stöds
  // (behåll befintlig URL-logik som backup)
}
```

### Steg 4: Spara startvy-koordinater för byggnader

**Databas: `building_settings`**

Lägg till fält för att spara Ivion startposition:

```sql
-- Ny kolumn för Ivion startvy-koordinater
ALTER TABLE building_settings 
ADD COLUMN IF NOT EXISTS ivion_start_vlon NUMERIC,
ADD COLUMN IF NOT EXISTS ivion_start_vlat NUMERIC;
```

**Fil: `src/pages/SplitViewer.tsx`**

Använd sparade koordinater för initial URL:

```typescript
// I SplitViewerContent:
const ivionUrl = useMemo(() => {
  let url = `${baseUrl}/?site=${buildingData.ivionSiteId}`;
  
  // Lägg till startvy om konfigurerad
  if (buildingData.startVlon !== undefined) {
    url += `&vlon=${buildingData.startVlon}`;
  }
  if (buildingData.startVlat !== undefined) {
    url += `&vlat=${buildingData.startVlat}`;
  }
  
  return url;
}, [baseUrl, buildingData]);
```

### Steg 5: Förbättra debug-logging

**Fil: `src/hooks/useIvionCameraSync.ts`**

Logga alla inkommande postMessage för att verifiera dataformat:

```typescript
const handleMessage = async (event: MessageEvent) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  // NYTT: Logga alla NavVis-relaterade meddelanden för debugging
  if (data.type?.includes('navvis') || data.type?.includes('ivion') || 
      data.event?.includes('camera') || data.position) {
    console.log('[Ivion Sync] postMessage received:', JSON.stringify(data, null, 2));
  }
  
  // ... resten av hanteringen
};
```

---

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/hooks/useIvionCameraSync.ts` | Extrahera position direkt från postMessage, lägg till debug-logging |
| `src/pages/SplitViewer.tsx` | Använd startvy-koordinater i Ivion URL |

---

## Förväntade resultat

Efter implementation:

1. **360° → 3D**: Realtidssynk utan backend-anrop (om Ivion skickar position)
2. **3D → 360°**: Snabb synk via postMessage (om Ivion stöder moveToLocation)
3. **Fallback**: Befintlig URL-baserad synk fungerar som backup
4. **Startvy**: Byggnader öppnas med korrekt initial kameraposition

---

## Verifieringssteg

1. Öppna Split View för Akerselva
2. Kontrollera konsolen för `[Ivion Sync] postMessage received:`
3. Verifiera att `position: {x, y, z}` finns i loggarna
4. Om position finns → Synk ska fungera automatiskt
5. Om position saknas → Vi behöver lägga till NavVis Frontend SDK

---

## Om postMessage inte skickar position

Om NavVis-instansen inte skickar position i postMessage, finns dessa alternativ:

| Alternativ | Beskrivning | Komplexitet |
|------------|-------------|-------------|
| **A: NavVis Frontend SDK** | Integrera SDK i iframe via script-injektion | Hög |
| **B: URL-parsing** | Extrahera position från iframe.src efter navigation | Medel |
| **C: Utöka backend** | Scanna alla 17 datasets (istället för 2) | Medel |
| **D: Manuell synk** | Användaren klistrar in URL (redan implementerat) | Låg |

---

## Angående startposition (vlon/vlat)

För att spara `vlon=-1.38&vlat=-0.25` som startposition för Akerselva:

```sql
UPDATE building_settings 
SET ivion_start_vlon = -1.38, ivion_start_vlat = -0.25
WHERE fm_guid = '9baa7a3a-717d-4fcb-8718-0f5ca618b28a';
```

Dessa värden är **vinklar i radianer** (inte geografiska koordinater):
- `vlon` = yaw (horisontell rotation, -π till π)
- `vlat` = pitch (vertikal vinkel, -π/2 till π/2)
