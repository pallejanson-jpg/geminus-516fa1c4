
# Plan: Split View Synkronisering via Ivion Image ID

## Sammanfattning

NavVis Ivion exponerar sin position via URL-parametern `image=XXX` där XXX är ID:t för den panoramabild användaren tittar på. Genom att:
1. Hämta bildpositionen via Ivion API (`GET /images/{imageId}`)
2. Transformera koordinaterna till BIM-lokala koordinater
3. Flytta 3D-kameran dit

...kan vi uppnå **360° → 3D synkronisering**.

För **3D → 360°** kan vi:
1. Hitta närmaste Ivion-bild baserat på 3D-kamerans position
2. Uppdatera iframe:ns URL med `&image=XXX`

---

## Ivion URL-format (bekräftat)

```
https://swg.iv.navvis.com/?site={siteId}&vlon={yaw_rad}&vlat={pitch_rad}&fov={fov_deg}&image={imageId}
```

| Parameter | Betydelse | Enhet |
|-----------|-----------|-------|
| `site` | Ivion Site ID | string |
| `vlon` | Kamerans yaw/heading | radianer |
| `vlat` | Kamerans pitch | radianer |
| `fov` | Field of view | grader |
| `image` | Aktuell panoramabild-ID | number |

---

## Lösningsarkitektur

```text
┌─────────────────────────────────────────────────────────────────┐
│                    Split View Sync (NY DESIGN)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   360° Ivion                              3D xeokit             │
│       │                                       │                 │
│       │ 1. hashchange event                   │                 │
│       ├──────────────────────────────────────►│                 │
│       │    (parse image=XXX)                  │                 │
│       │                                       │                 │
│       │ 2. Fetch image position               │                 │
│       │    GET /images/{imageId}              │                 │
│       │                                       │                 │
│       │ 3. Transform coords → flyTo           │                 │
│       │                                       │                 │
│       │◄──────────────────────────────────────┤                 │
│       │ 4. 3D camera change                   │                 │
│       │    → find nearest image               │                 │
│       │    → update iframe.src                │                 │
│       │                                       │                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Del 1: Hämta Ivion-bildpositioner (Backend)

### Ny Edge Function: `ivion-get-image-position`

Skapar en ny action i befintliga `ivion-poi` edge function för att hämta bildposition.

```typescript
// Ny action i ivion-poi/index.ts

case 'get-image-position':
  if (!params.imageId) throw new Error('imageId required');
  const token = await getIvionToken();
  
  const imageResp = await fetch(`${IVION_API_URL}/api/images/${params.imageId}`, {
    headers: { 'x-authorization': `Bearer ${token}` },
  });
  
  if (!imageResp.ok) throw new Error(`Image not found: ${params.imageId}`);
  
  const image = await imageResp.json();
  // Image response includes: { id, location: {x, y, z}, orientation: {...}, ... }
  result = {
    id: image.id,
    location: image.location, // {x, y, z} i meter (lokala Ivion-koordinater)
    orientation: image.orientation,
    datasetId: image.datasetId,
  };
  break;

case 'get-images-for-site':
  // Hämta alla bilder för en site (för att kunna hitta närmaste bild)
  if (!params.siteId) throw new Error('siteId required');
  const token2 = await getIvionToken();
  
  // Hämta datasets för siten
  const datasetsResp = await fetch(`${IVION_API_URL}/api/site/${params.siteId}/datasets`, {
    headers: { 'x-authorization': `Bearer ${token2}` },
  });
  const datasets = await datasetsResp.json();
  
  // Hämta bilder för varje dataset
  const allImages = [];
  for (const ds of datasets) {
    const imagesResp = await fetch(`${IVION_API_URL}/api/dataset/${ds.id}/images`, {
      headers: { 'x-authorization': `Bearer ${token2}` },
    });
    const images = await imagesResp.json();
    allImages.push(...images.map(img => ({
      id: img.id,
      location: img.location,
      datasetId: ds.id,
    })));
  }
  
  result = { images: allImages };
  break;
```

---

## Del 2: Refaktorera useIvionCameraSync

### Ny strategi: URL-baserad synk istället för postMessage

```typescript
// src/hooks/useIvionCameraSync.ts - NY IMPLEMENTATION

import { useEffect, useRef, useCallback, useState } from 'react';
import { useViewerSync, LocalCoords } from '@/context/ViewerSyncContext';
import { supabase } from '@/integrations/supabase/client';
import { geoToBimHeading, normalizeHeading, type BuildingOrigin } from '@/lib/coordinate-transform';

interface IvionImage {
  id: number;
  location: { x: number; y: number; z: number };
  datasetId: number;
}

interface UseIvionCameraSyncOptions {
  iframeRef: React.RefObject<HTMLIFrameElement>;
  enabled: boolean;
  buildingOrigin: BuildingOrigin | null;
  ivionSiteId: string;
}

export function useIvionCameraSync({
  iframeRef,
  enabled,
  buildingOrigin,
  ivionSiteId,
}: UseIvionCameraSyncOptions): void {
  const { syncLocked, syncState, updateFromIvion, updateFrom3D } = useViewerSync();
  
  // Cache av alla bilder för att hitta närmaste
  const [imageCache, setImageCache] = useState<IvionImage[]>([]);
  const lastImageIdRef = useRef<number | null>(null);
  const isSyncingRef = useRef(false);

  // 1. Ladda alla bilder för siten vid mount
  useEffect(() => {
    if (!enabled || !ivionSiteId) return;
    
    const loadImages = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('ivion-poi', {
          body: { action: 'get-images-for-site', siteId: ivionSiteId },
        });
        
        if (data?.images) {
          setImageCache(data.images);
          console.log(`[Ivion Sync] Loaded ${data.images.length} images for site`);
        }
      } catch (e) {
        console.error('[Ivion Sync] Failed to load images:', e);
      }
    };
    
    loadImages();
  }, [enabled, ivionSiteId]);

  // 2. Lyssna på hashchange för att fånga image-byten
  useEffect(() => {
    if (!enabled || !syncLocked) return;
    
    const checkIframeUrl = () => {
      // Vi kan inte läsa cross-origin iframe URL direkt,
      // men vi kan lyssna på window.postMessage om Ivion skickar det
      // ELLER använda polling av iframe.contentWindow.location (misslyckas pga CORS)
    };
    
    // Alternativ approach: Polling av Ivion API för senast visade bild
    // Om Ivion exponerar "current image" via API
    
  }, [enabled, syncLocked]);

  // 3. När 3D-kameran ändras → hitta närmaste bild → uppdatera iframe URL
  useEffect(() => {
    if (!enabled || !syncLocked) return;
    if (syncState.source !== '3d' || !syncState.position) return;
    if (!iframeRef.current || imageCache.length === 0) return;
    if (isSyncingRef.current) return;
    
    // Hitta närmaste bild
    const pos = syncState.position;
    let nearestImage: IvionImage | null = null;
    let nearestDist = Infinity;
    
    for (const img of imageCache) {
      const dx = img.location.x - pos.x;
      const dy = img.location.y - pos.y;
      const dz = img.location.z - pos.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestImage = img;
      }
    }
    
    if (!nearestImage || nearestImage.id === lastImageIdRef.current) return;
    if (nearestDist > 10) return; // Max 10m avstånd
    
    lastImageIdRef.current = nearestImage.id;
    isSyncingRef.current = true;
    
    // Uppdatera iframe URL med ny bild
    const currentUrl = new URL(iframeRef.current.src);
    currentUrl.searchParams.set('image', String(nearestImage.id));
    
    // Konvertera heading till radianer för vlon
    const vlonRad = (syncState.heading * Math.PI) / 180;
    const vlatRad = (syncState.pitch * Math.PI) / 180;
    currentUrl.searchParams.set('vlon', vlonRad.toFixed(2));
    currentUrl.searchParams.set('vlat', vlatRad.toFixed(2));
    
    console.log('[Ivion Sync] Navigating to image:', nearestImage.id);
    iframeRef.current.src = currentUrl.toString();
    
    setTimeout(() => { isSyncingRef.current = false; }, 1000);
  }, [enabled, syncLocked, syncState, imageCache, iframeRef]);
}
```

---

## Del 3: Ivion → 3D Synk (svårare)

### Problemet
Vi kan **inte läsa** en cross-origin iframe:s URL pga webbläsarsäkerhet.

### Möjliga lösningar

#### Alternativ A: Polling via Backend (rekommenderas)
Ivion API har möjlighet att exponera "senast visade bild" per session/användare, men detta är oklart utan djupare dokumentation.

#### Alternativ B: hashchange via proxy-sida (komplex)
Om vi kontrollerar Ivion-hosten kan vi lägga in JavaScript som skickar `postMessage` vid navigation.

#### Alternativ C: Manuell synk-knapp (enklast)
Lägg till en "Synka 360° → 3D" knapp som:
1. Öppnar Ivion i ny flik
2. Användaren kopierar aktuell URL
3. Appen läser `image=XXX` från inmatningen

#### Alternativ D: NavVis IndoorViewer SDK
Om ni har tillgång till SDK:t kan den injiceras och skicka `postMessage` vid navigation.

---

## Del 4: Förenklad Implementation (Fas 1)

### Vad vi implementerar nu:

| Funktion | Beskrivning | Komplexitet |
|----------|-------------|-------------|
| 3D → 360° synk | Hitta närmaste bild, uppdatera iframe URL | Medel |
| Initial synk | Båda startar på samma plats (3D:s startposition) | Enkel |
| Synk-knapp | "Synka nu" knapp som tvingar uppdatering | Enkel |
| 360° → 3D synk | **Manuell via URL-input** (tills SDK finns) | Enkel |

### UI-förändringar

```typescript
// SplitViewer.tsx - Lägg till i header

<Button
  variant="outline"
  size="sm"
  onClick={handleSyncToIvion}
  disabled={!hasOrigin || imageCache.length === 0}
>
  <RefreshCw className="h-4 w-4 mr-1" />
  Synka 360° till 3D
</Button>

{/* Dialog för manuell Ivion → 3D synk */}
<Dialog open={showSyncDialog} onOpenChange={setShowSyncDialog}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Synka från 360°</DialogTitle>
    </DialogHeader>
    <p className="text-sm text-muted-foreground mb-4">
      Kopiera URL:en från Ivion (högerklicka → Kopiera länkadress) och klistra in nedan:
    </p>
    <Input
      value={ivionUrlInput}
      onChange={(e) => setIvionUrlInput(e.target.value)}
      placeholder="https://swg.iv.navvis.com/?site=...&image=..."
    />
    <DialogFooter>
      <Button onClick={handleParseIvionUrl}>
        Synka
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `supabase/functions/ivion-poi/index.ts` | Lägg till `get-image-position` och `get-images-for-site` actions |
| `src/hooks/useIvionCameraSync.ts` | Helt omskriven: URL-baserad synk, bildcache, närmaste-bild-logik |
| `src/pages/SplitViewer.tsx` | Lägg till synk-knappar, dialog för manuell URL-input |
| `src/components/viewer/Ivion360View.tsx` | Skicka `ivionSiteId` till sync-hook istället för `ivionOrigin` |

---

## Framtida förbättringar (Fas 2)

### Om ni får tillgång till NavVis IndoorViewer SDK:

```javascript
// Kod som kan injiceras i Ivion-viewer
viewer.on('imageChange', (imageId) => {
  window.parent.postMessage({
    type: 'ivion-image-change',
    imageId: imageId,
    location: viewer.currentImage.location,
    vlon: viewer.camera.yaw,
    vlat: viewer.camera.pitch,
  }, '*');
});
```

Med detta skulle full tvåvägssynk vara möjlig utan manuell URL-kopiering.

---

## Teknisk detalj: Koordinatsystem

### Ivion bildpositioner
Ivion-bilder har en `location: {x, y, z}` i **lokala meter-koordinater** relativt till en scannings-origin. Dessa behöver mappas till BIM-koordinater.

### Transformation
Om BIM-modellen och Ivion-scannern har samma origin:
- `ivion.location.x` ≈ `bim.x`
- `ivion.location.y` ≈ `bim.z` (höjd kan variera)
- `ivion.location.z` ≈ `bim.y` (Y-up vs Z-up)

Om de har olika origin behövs en offset som konfigureras per byggnad.

### Byggnadsinställningar (utöka)
Lägg till i `building_settings`:
- `ivion_offset_x` - Offset mellan Ivion och BIM origin X
- `ivion_offset_y` - Offset Y
- `ivion_offset_z` - Offset Z
- `ivion_rotation` - Rotation mellan koordinatsystemen

---

## Sammanfattning

1. **3D → 360°**: Fungerar genom att hitta närmaste Ivion-bild och uppdatera iframe URL
2. **360° → 3D**: Kräver manuell URL-input (eller SDK-integration i framtiden)
3. **Initial synk**: 3D styr startposition, hittar närmaste bild, laddar den i Ivion
4. **Heading/Pitch synk**: `vlon`/`vlat` i radianer mappar till 3D:s heading/pitch

Denna lösning ger funktionell synk utan att behöva SDK-tillgång, med en tydlig väg framåt för fullständig integration.
