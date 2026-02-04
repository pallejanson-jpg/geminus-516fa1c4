
# Plan: Komplett Split View-fix (Synk, XKT-preload, Token-renewal, Tillbaka-knapp)

## Sammanfattning

Det finns fyra separata problem som alla behöver lösas för att Split View ska fungera korrekt:

| Problem | Orsak | Lösning |
|---------|-------|---------|
| **1. Synkronisering saknas** | `useViewerCameraSync` anropas aldrig i `AssetPlusViewer` | Anslut hook och skicka sync-callbacks från SplitViewer |
| **2. Gemensam startpunkt** | Ingen logik för att synkronisera initial position | Automatisk synk baserat på första Ivion-position |
| **3. XKT-preload långsam** | Preload startar men binärdata hämtas inte effektivt | Optimera fetch-strategi och använd memory cache |
| **4. Ivion token-renewal** | Token cachar men UI visar inte förnyelseprocess | Automatisk renewal i edge function + UI-feedback |
| **5. Tillbaka-knappen** | `navigate(-1)` och `window.location.href` fel | Explicit navigering med `navigate('/')` |

---

## Problem 1: Synkronisering mellan 3D och 360°

### Nuläge

Hooks finns men är **inte anslutna**:

```text
AssetPlusViewer.tsx:
  ❌ Importerar INTE useViewerCameraSync
  ❌ Lyssnar INTE på kameraändringar
  ❌ Skickar INTE updateFrom3D()

Ivion360View.tsx:
  ✓ Importerar useIvionCameraSync
  ✓ Hook anropas med buildingOrigin
  ❓ Men Ivion API kanske inte skickar camera-changed events automatiskt
```

### Lösning

**Steg 1: Uppdatera AssetPlusViewer.tsx**

| Ändring | Beskrivning |
|---------|-------------|
| Lägg till sync-props | `syncEnabled`, `onCameraChange`, `syncPosition` |
| Importera och anropa `useViewerCameraSync` | Anslut till xeokit kamera |
| Exponera viewerRef | För extern åtkomst från SplitViewer |

```typescript
// Nya props
interface AssetPlusViewerProps {
  fmGuid: string;
  onClose?: () => void;
  pickModeEnabled?: boolean;
  onCoordinatePicked?: (...) => void;
  // NYA sync-props
  syncEnabled?: boolean;
  onCameraChange?: (position: LocalCoords, heading: number, pitch: number) => void;
  syncPosition?: LocalCoords | null;
  syncHeading?: number;
  syncPitch?: number;
}
```

**Steg 2: Uppdatera SplitViewer.tsx**

| Ändring | Beskrivning |
|---------|-------------|
| Hantera `updateFrom3D` och `updateFromIvion` | Transformera koordinater mellan systemen |
| Skicka sync-props till båda viewers | `syncEnabled`, positions, callbacks |
| Initiera synk från första Ivion-position | Gemensam startpunkt automatiskt |

---

## Problem 2: Gemensam startpunkt

### Alternativ

| Alternativ | Beskrivning | Rekommendation |
|------------|-------------|----------------|
| **Automatisk** | Första Ivion camera-event sätter startpunkten för 3D | ✓ Bäst UX |
| **Manuell** | Knapp "Synka hit" i båda vyerna | Mer kontroll men krångligare |
| **Baserat på Startvy** | Om byggnaden har `start_view_id`, använd den | Kan kombineras |

**Rekommenderad lösning: Automatisk + Manuell backup**

1. När Split View öppnas, vänta på första Ivion camera-event
2. Transformera Ivion-position till BIM-koordinater
3. Flyga 3D-kameran dit
4. Sync-knappen kan användas för att manuellt återsynkronisera

---

## Problem 3: XKT-preload är för långsam

### Nuläge

```text
useXktPreload.ts:
  ✓ Kontrollerar om modeller finns i xkt_models
  ✓ Hämtar signed URLs
  ❌ Begränsar till endast 5 modeller (models.slice(0, 5))
  ❌ Ingen parallell streaming
  ❌ Stora modeller blockar (synkron ArrayBuffer)
```

### Lösning

| Åtgärd | Beskrivning |
|--------|-------------|
| Ta bort 5-modell-begränsningen | Ladda alla modeller parallellt |
| Använd `Promise.all` med streams | Snabbare parallell nedladdning |
| Prioritera mindre modeller först | Snabbare initial rendering |
| Visa laddningsindikator | Pulsande "Laddar 3D..." overlay |

**Optimerad preload-logik:**

```typescript
// Sortera modeller efter storlek (minst först)
const sortedModels = models.sort((a, b) => 
  (a.file_size || 0) - (b.file_size || 0)
);

// Ladda parallellt med begränsad concurrency
const CONCURRENT_FETCHES = 3;
await pLimit(CONCURRENT_FETCHES, sortedModels, async (model) => {
  // ... fetch och cache
});
```

---

## Problem 4: Ivion token-renewal

### Nuläge

```text
ivion-auth.ts (edge function):
  ✓ Automatisk token-refresh
  ✓ Fallback till username/password login
  ✓ Sparar tokens till building_settings

Ivion360View (frontend):
  ❌ Visar "token expired" utan åtgärd
  ❌ Ingen automatisk retry
```

Token-renewal fungerar på backend men frontend hanterar inte förnyelse transparent.

### Lösning

| Åtgärd | Fil |
|--------|-----|
| Lägg till token-validering vid iframe-load | `Ivion360View.tsx` |
| Anropa edge function för att förnya token om utgånget | `Ivion360View.tsx` |
| Visa diskret "Förnyar anslutning..." istället för fel | `Ivion360View.tsx` |

**Ny token-check vid iframe load:**

```typescript
// I Ivion360View.tsx
useEffect(() => {
  const checkAndRefreshToken = async () => {
    if (!buildingFmGuid) return;
    
    try {
      const { data } = await supabase.functions.invoke('ivion-poi', {
        body: { action: 'validate-token', buildingFmGuid }
      });
      
      if (data?.tokenRenewed) {
        console.log('Token förnyat automatiskt');
      }
    } catch (e) {
      console.warn('Token check failed:', e);
    }
  };
  
  checkAndRefreshToken();
}, [buildingFmGuid]);
```

---

## Problem 5: Tillbaka-knappen

### Nuläge

```text
FacilityLandingPage.tsx rad 592:
  window.location.href = `/split-viewer?...`  ← Helsidesladdning!

SplitViewer.tsx rad 57:
  navigate(-1);  ← Opålitligt med iframe-historik
```

### Lösning

| Fil | Ändring |
|-----|---------|
| `FacilityLandingPage.tsx` | `navigate('/split-viewer?...')` istället för `window.location.href` |
| `SplitViewer.tsx` | `navigate('/')` istället för `navigate(-1)` |

---

## Filer att ändra

| Fil | Ändringar |
|-----|-----------|
| `src/components/viewer/AssetPlusViewer.tsx` | Lägg till sync-props, importera och anropa `useViewerCameraSync` |
| `src/pages/SplitViewer.tsx` | Koordinera synk mellan viewers, fixa tillbaka-knapp |
| `src/components/viewer/Ivion360View.tsx` | Lägg till token-validering vid load |
| `src/hooks/useXktPreload.ts` | Optimera preload-strategi |
| `src/components/portfolio/FacilityLandingPage.tsx` | Fixa navigation till SplitViewer |
| `supabase/functions/ivion-poi/index.ts` | Lägg till `validate-token` action |

---

## Dataflöde efter implementation

```text
┌─────────────────────────────────────────────────────────────────────┐
│                         SplitViewer.tsx                             │
│                                                                     │
│  ┌──────────────────┐              ┌──────────────────┐             │
│  │ AssetPlusViewer  │◄────────────►│  Ivion360View    │             │
│  │                  │  syncState   │                  │             │
│  │ useViewer-       │              │ useIvion-        │             │
│  │ CameraSync ────►─┼──updateFrom──┼►CameraSync       │             │
│  │       ◄─────────┼─3D/Ivion────┼────────►         │             │
│  └──────────────────┘              └──────────────────┘             │
│                                                                     │
│                    ViewerSyncContext                                │
│                    (koordinat-transformation)                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Prioriteringsordning

| Prio | Åtgärd | Komplexitet |
|------|--------|-------------|
| 1 | Fixa tillbaka-knappen | Låg |
| 2 | Anslut synk-hooks till viewers | Medel |
| 3 | Implementera gemensam startpunkt | Medel |
| 4 | Optimera XKT-preload | Medel |
| 5 | Token-renewal UI | Låg |

---

## Acceptanskriterier

1. ✓ Tillbaka-knappen fungerar korrekt från Split View
2. ✓ Navigering i 3D uppdaterar 360°-vyn (om synk är på)
3. ✓ Navigering i 360° uppdaterar 3D-vyn (om synk är på)
4. ✓ Gemensam startpunkt etableras automatiskt
5. ✓ XKT-modeller laddas snabbare med visuell feedback
6. ✓ Ivion token förnyas automatiskt utan användarinteraktion
