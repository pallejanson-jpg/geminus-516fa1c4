
# Plan: Automatisk 360° ↔ 3D Synkronisering

## Mål
Ta bort behovet av manuell kopiering av URL:er. Synkroniseringen ska ske automatiskt i båda riktningar.

## Teknisk Lösning

### Arkitektur

```text
┌─────────────────────────────────────────────────────────────────────┐
│                AUTOMATISK SYNKRONISERING                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐                  ┌─────────────────┐          │
│  │   3D xeokit     │                  │  Ivion 360°     │          │
│  │                 │                  │  (iframe)       │          │
│  │  camera.on()    │                  │                 │          │
│  │       │         │                  │                 │          │
│  └───────┼─────────┘                  └─────────────────┘          │
│          │                                   ▲                      │
│          │ 1. Kamera rör sig                 │                      │
│          ▼                                   │                      │
│  ┌─────────────────┐                         │                      │
│  │ Hitta närmaste  │                         │                      │
│  │ Ivion-bild      │                         │                      │
│  │ (lokal cache)   │                         │                      │
│  └────────┬────────┘                         │                      │
│           │                                  │                      │
│           │ 2. Uppdatera iframe.src          │                      │
│           │    med &image=XXX               │                      │
│           ▼                                  │                      │
│  ┌─────────────────────────────────────────────┐                   │
│  │          iframe.src = ?site=...&image=XXX   │                   │
│  │          &vlon=heading&vlat=pitch           │                   │
│  └─────────────────────────────────────────────┘                   │
│                                                                     │
│  ════════════════════════════════════════════════════              │
│                                                                     │
│  360° → 3D: Dual-approach för maximal kompatibilitet               │
│                                                                     │
│  ┌─────────────────┐     A: postMessage (om Ivion stöder)          │
│  │  Ivion 360°     │────────────────────────────────────►          │
│  │  navigation     │     type: 'navvis-event'                      │
│  │                 │     event: 'camera-changed'                   │
│  │                 │     data: { imageId, yaw, pitch }             │
│  └─────────────────┘                                               │
│          │                                                          │
│          │              B: Polling av senaste POI-aktivitet        │
│          │              (backup om postMessage ej fungerar)        │
│          ▼                                                          │
│  ┌─────────────────┐                                               │
│  │ Hämta bild-     │                                               │
│  │ position via API│                                               │
│  │ GET /images/XXX │                                               │
│  └────────┬────────┘                                               │
│           │                                                         │
│           ▼                                                         │
│  ┌─────────────────┐                                               │
│  │ 3D viewer.flyTo │                                               │
│  │ (position,      │                                               │
│  │  heading, pitch)│                                               │
│  └─────────────────┘                                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation

### 1. Skicka subscribe-kommando vid iframe-laddning

När Ivion-iframen laddas skickar vi ett `subscribe`-kommando för att aktivera kamera-events:

**Fil: `src/components/viewer/Ivion360View.tsx`**

```typescript
const handleIframeLoad = useCallback(() => {
  setIsLoading(false);
  
  // Skicka subscribe-kommando för att aktivera kamera-events
  if (syncEnabled && iframeRef.current?.contentWindow) {
    const subscribeCommands = [
      { type: 'navvis-command', action: 'subscribe' },
      { type: 'navvis-command', action: 'subscribe', events: ['camera-changed', 'image-changed'] },
      { type: 'navvis-subscribe', events: ['cameraUpdate', 'imageChange'] },
    ];
    
    setTimeout(() => {
      subscribeCommands.forEach(cmd => {
        try {
          iframeRef.current?.contentWindow?.postMessage(cmd, '*');
        } catch (e) {
          // Ignorera fel
        }
      });
      console.log('[Ivion] Sent subscribe commands');
    }, 1500);
  }
}, [syncEnabled]);
```

### 2. Lyssna på postMessage-events från Ivion

**Fil: `src/hooks/useIvionCameraSync.ts`**

Utöka hooken med en event-lyssnare som fångar kamera-ändringar:

```typescript
// Lyssna på postMessage från Ivion iframe
useEffect(() => {
  if (!enabled || !syncLocked) return;
  
  const handleMessage = async (event: MessageEvent) => {
    const data = event.data;
    
    // NavVis kan skicka olika format
    if (data?.type === 'navvis-event') {
      console.log('[Ivion Sync] Received navvis-event:', data);
      
      if (data.event === 'camera-changed' || data.event === 'image-changed') {
        const eventData = data.data || {};
        const imageId = eventData.imageId || eventData.image;
        const heading = eventData.yaw ?? eventData.heading ?? 0;
        const pitch = eventData.pitch ?? 0;
        
        if (imageId && imageId !== lastSyncedImageIdRef.current) {
          await handleIvionImageChange(imageId, heading, pitch);
        }
      }
    }
    
    // Alternativt format: direkt kameradata
    if (data?.imageId || data?.currentImage) {
      const imageId = data.imageId || data.currentImage;
      if (imageId !== lastSyncedImageIdRef.current) {
        await handleIvionImageChange(imageId, data.heading || 0, data.pitch || 0);
      }
    }
  };
  
  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
}, [enabled, syncLocked]);

// Hantera bild-byte från Ivion
const handleIvionImageChange = async (imageId: number, heading: number, pitch: number) => {
  if (isSyncingRef.current) return;
  isSyncingRef.current = true;
  
  try {
    // Hämta bildposition från API
    const { data, error } = await supabase.functions.invoke('ivion-poi', {
      body: {
        action: 'get-image-position',
        imageId,
        buildingFmGuid,
      },
    });
    
    if (data?.success && data?.location) {
      const position: LocalCoords = {
        x: data.location.x,
        y: data.location.y,
        z: data.location.z,
      };
      
      console.log('[Ivion Sync] Updating 3D from image:', imageId);
      updateFromIvion(position, heading, pitch);
      lastSyncedImageIdRef.current = imageId;
    }
  } catch (e) {
    console.error('[Ivion Sync] Failed to handle image change:', e);
  } finally {
    setTimeout(() => { isSyncingRef.current = false; }, 500);
  }
};
```

### 3. Fallback: Polling för 360° → 3D

Om postMessage inte stöds av Ivion-instansen, använd polling som backup:

```typescript
// Polling-baserad fallback (om postMessage ej fungerar)
useEffect(() => {
  if (!enabled || !syncLocked || !ivionSiteId) return;
  if (postMessageWorking.current) return; // Hoppa över om postMessage fungerar
  
  const pollInterval = setInterval(async () => {
    // Hämta senaste POI-aktivitet eller annan indikation
    // (Begränsad funktionalitet - mest för POI-skapande)
  }, 5000);
  
  return () => clearInterval(pollInterval);
}, [enabled, syncLocked, ivionSiteId]);
```

### 4. Ta bort manuella sync-dialoger

**Fil: `src/pages/SplitViewer.tsx`**

- Ta bort "360° → 3D"-knappen och dialogen för URL-inklistring
- Behåll enbart sync-toggle och reset-knapp
- Lägg till en statusindikator som visar synkstatus

```typescript
// Ersätt manuell dialog med statusindikator
<div className="flex items-center gap-1">
  {/* Status indicator */}
  <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-2">
    <span className={cn(
      "h-2 w-2 rounded-full",
      syncState.source === 'ivion' ? "bg-green-500" :
      syncState.source === '3d' ? "bg-blue-500" : "bg-gray-400"
    )} />
    <span>
      {syncState.source === 'ivion' ? '360° → 3D' :
       syncState.source === '3d' ? '3D → 360°' : 'Väntar...'}
    </span>
  </div>
  
  {/* Sync toggle */}
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant={syncLocked ? 'default' : 'outline'}
        size="sm"
        onClick={() => setSyncLocked(!syncLocked)}
      >
        {syncLocked ? <Link2 /> : <Link2Off />}
        Sync {syncLocked ? 'ON' : 'OFF'}
      </Button>
    </TooltipTrigger>
  </Tooltip>
</div>
```

---

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/hooks/useIvionCameraSync.ts` | Lägg till postMessage-lyssnare, `handleIvionImageChange`, och automatisk 360° → 3D synk |
| `src/components/viewer/Ivion360View.tsx` | Skicka subscribe-kommando vid iframe onLoad |
| `src/pages/SplitViewer.tsx` | Ta bort manuell sync-dialog, lägg till statusindikator |

---

## Tekniska detaljer

### NavVis postMessage API (förväntad struktur)

NavVis IVION kan stödja postMessage-kommunikation:

**Skicka (från värd → iframe):**
```javascript
iframe.contentWindow.postMessage({
  type: 'navvis-command',
  action: 'subscribe',
  events: ['camera-changed', 'image-changed']
}, '*');
```

**Ta emot (från iframe → värd):**
```javascript
{
  type: 'navvis-event',
  event: 'camera-changed',
  data: {
    imageId: 286928215558994,
    yaw: 6.62,      // radianer
    pitch: -0.34,   // radianer
    fov: 100.0
  }
}
```

### Koordinattransformation

Ivion-bilder har position i lokala koordinater `{x, y, z}` i meter. Dessa mappas direkt till xeokit:s koordinatsystem (om origin matchar).

Om offset behövs kan det konfigureras i `building_settings`:
- `ivion_offset_x`, `ivion_offset_y`, `ivion_offset_z`

### Fallback-strategi

Om postMessage inte fungerar (vissa Ivion-versioner stöder det kanske inte):
1. Systemet fortsätter med envägs-synk (3D → 360°)
2. En liten "Synka manuellt"-knapp visas som öppnar Ivion i ny flik
3. Användaren kan då kopiera URL:en enklare (från webbläsarens adressfält)

---

## Förväntad användarupplevelse

1. Användaren öppnar Split View
2. Båda visare laddas med initial position
3. När användaren navigerar i **3D** → 360°-vyn hoppar automatiskt till närmaste panorama
4. När användaren navigerar i **360°** → 3D-vyn flyger till samma position (om postMessage fungerar)
5. Synk-toggle kan stängas av för oberoende navigation
6. Statusindikator visar vilken vy som senast uppdaterade

---

## Testplan

1. **3D → 360°**: Flytta kameran i 3D, verifiera att 360° hoppar till rätt bild
2. **360° → 3D (postMessage)**: Navigera i Ivion, se om 3D följer automatiskt
3. **Fallback**: Om postMessage ej fungerar, verifiera att manuell synk via URL fortfarande är möjlig
4. **Sync toggle**: Verifiera att OFF faktiskt stänger av synk
5. **Performance**: Kontrollera att polling/events inte orsakar fördröjning eller flimmer
