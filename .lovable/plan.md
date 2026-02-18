
# Plan: Tre parallella fixes

## 1. Mobil 3D-layout — responsivitetsproblem

### Nulägesanalys
Från koden i `AssetPlusViewer.tsx` (rad 3643–3720) och `MobileViewerOverlay.tsx`:

**Problem A: NavCube sitter för lågt**
NavCube-canvaset positioneras med `bottom: 'calc(env(safe-area-inset-bottom, 12px) + 74px)'`. Det hamnar alltså 74px + safe-area från botten – men ViewerToolbar (som renderas på desktop) renderas inte på mobil. NavCuben tar alltså plats mitt i 3D-vy.

**Problem B: FloorCarousel och FloorSwitcher renderas inte på mobil**
`FloatingFloorSwitcher` är insvept i `{!isMobile && (...)}` (rad 3770) – rätt. Men FloorCarousel renderas alltid (rad 3838). Den kan störa layout på mobil.

**Problem C: Byggnadsnamn visas under 3D i ett banner-element**
`AssetPlusViewer` renderar ingen explicit banner under 3D på mobil. Bannet med byggnadsnamnet + "2D/3D-switch" kommer sannolikt från ett annat element ovanför viewern – troligen `SyncProgressBanner` eller ett inlindningselement i `MainContent.tsx` eller `AppLayout.tsx` som fortfarande visar sig på mobil.

**Problem D: ViewerRightPanel (settings-sheet) är för stor**
`ViewerRightPanel` är en Sheet som öppnas via Settings2-knappen i MobileViewerOverlay. På mobil öppnar Sheet-komponenten som default en sidosheet – det kan ta för stor andel av skärmen.

### Fixes

**Fix 1: Lägg NavCube på bättre position på mobil**
```tsx
// Nuvarande (alltid samma offset):
style={{ bottom: 'calc(env(safe-area-inset-bottom, 12px) + 74px)' }}

// Ny (skilj mobil/desktop):
style={{ 
  bottom: isMobile 
    ? 'calc(env(safe-area-inset-bottom, 12px) + 16px)' 
    : 'calc(env(safe-area-inset-bottom, 12px) + 74px)' 
}}
```

**Fix 2: Dölj FloatingFloorSwitcher och FloorCarousel på mobil**
FloatingFloorSwitcher är redan dold. FloorCarousel: lägg till `{!isMobile && (<FloorCarousel .../>)}`.

**Fix 3: Identifiera och ta bort banner ovanför 3D**
Söker i `MainContent.tsx`, `AppLayout.tsx` och `SyncProgressBanner.tsx` efter vad som renderas ovanför viewer-ytan på mobil. Det är sannolikt ett element med byggnadsnamn + 2D/3D-toggle i layout-lagret. Vi sätter `display: none` på mobil eller döljer det via props.

**Fix 4: ViewerRightPanel på mobil — kompaktare sheet**
SheetContent på mobil får `side="bottom"` och `className="max-h-[70vh]"` istället för default side-sheet. Ändras via `isMobile`-prop i ViewerRightPanel.

---

## 2. AI-skanningsfunktion — djupanalys och rekommendation

### Nulägesanalys av bottlenecks

Från `BrowserScanRunner.tsx`:
```
ROTATIONS_PER_POSITION = 6
ROTATION_DELAY_MS = 1500
CAPTURE_DELAY_MS = 500
MAX_IMAGES_PER_SCAN = 200
```

**Tidskalkyl per bild:**
- Navigation + wait: `await sleep(2000)` = **2 000 ms**
- Per rotation (6 st): `CAPTURE_DELAY_MS (500) + analyzeScreenshot (AI-anrop) + ROTATION_DELAY_MS (1500)` ≈ **3 000–5 000 ms**
- Totalt per bildposition: `2000 + 6 × ~4000 = 26 000 ms = 26 sekunder per bild`
- Med 200 bilder: **200 × 26s = 86 minuter** — oanvändbart

**Primär bottleneck: AI-anropet (Gemini) per rotation**
`analyzeScreenshot()` gör ett Supabase Functions-anrop för varje rotation, som i sin tur anropar Gemini Vision API. Det tar 2–5 sekunder per anrop. 6 rotationer × 5s = 30s bara i AI-tid.

**Sekundär bottleneck: `await sleep(2000)` för panorama-render**
Onödigt lång wait. Ivion SDK renderar panoramat snabbare än 2 sekunder på moderna enheter.

**Tertiär: Rotation-logiken**
6 rotationer per position med 1500ms väntan = 9 sekunder extra per position utan AI-tid.

### Alternativa angreppsätt

**A. Batch-analys — skicka alla rotationer i ett AI-anrop**
Istället för att anropa Gemini 6 gånger per position, ta 6 screenshots och skicka dem i ett enda Gemini-anrop (multi-image). Gemini Vision stöder flera bilder per anrop.
- Tidsbesparing: 5 AI-anrop sparas per position → ~25 sekunder snabbare per position
- Implementeras i edge function `ai-asset-detection`:
```typescript
// Batch: samla screenshots för alla rotationer, sedan ett AI-anrop
const screenshots = [];
for (let rot = 0; rot < ROTATIONS_PER_POSITION; rot++) {
  screenshots.push(await captureScreenshot());
  await rotateView(60);
  await sleep(500); // Kortare wait
}
// Ett AI-anrop med alla bilder:
await analyzeBatch(screenshots, imageId, position);
```

**B. Färre rotationer med bredare synfält**
Minska från 6 till 3 rotationer (120° per rotation täcker mer). Halverar rotationstiden.

**C. Kortare navigation-wait**
Minska `await sleep(2000)` till `await sleep(800)`. Ivion SDK är normalt snabbare.

**D. Parallell analys med Worker**
Skicka screenshot till analys utan att invänta svaret — fortsätt navigera och rotera medan föregående analyseras asynkront. Komplex att implementera men halverar totaltiden.

**E. Sampling-förbättring**
Nuvarande sampling: var N:te bild. Bättre: spatial sampling (hoppa över bilder som är nära i 3D-rum). Kräver att bildernas 3D-koordinater används för avståndskalkyl.

**F. E57-format (NavVis)**
E57 innehåller punktmoln + panoramabilder. Fördelar: alla bilder i ett format utan navigationstid. Nackdelar: filer på 10–50 GB, kräver server-side parsing (ingen browserbaserad lösning), kräver helt nytt pipeline. **Inte rekommenderat** för nuvarande arkitektur.

### Marknadsöversikt — AI-bildigenkänning för inventering

**Liknande lösningar:**
1. **viAct** — AI safety/asset detection i byggmiljö. Använder video-feeds. Inte 360°-baserat.
2. **Mappedin + AI** — Indoor mapping + object recognition. Kräver egna sensorer.
3. **Matterport AI** — Har inbyggd object detection i sina 360°-skanningar. Bäst referens. Processen: 3D-skanning → AI post-processing off-line (batch), inte real-time.
4. **Leica Cyclone FIELD 360** — Skannar, exporterar E57/RCP, batch AI-analys offline.
5. **Samsara** — AI camera-based asset detection, men kräver dedikerade kameror.

**Nyckelinsikt från marknaden:** Alla professionella lösningar kör AI-analysen **batch/offline**, inte i real-time under navigering. Vår approach (navigera → ta screenshot → analysera → nästa bild) är korrekt i princip men för sekventiell.

**Rekommenderad förbättring:**
Implementera **batch-analys** (alternativ A) + **kortare waits** (alternativ C) + **3 rotationer** (alternativ B). Kombinerat ger detta:
```
Tid per position: 
Nuvarande:  2000 + 6 × (500 + 3000 + 1500) = 32 000 ms = 32 sek
Förbättrad: 800  + 3 × 500 (capture) + 1 AI-anrop (3000 ms) = 4 000 ms = 4 sek
```
→ **8x snabbare** — 200 bilder tar 13 min istället för 107 min.

### Konkreta kodändringar

**`BrowserScanRunner.tsx`:**
```typescript
const ROTATIONS_PER_POSITION = 3; // från 6
const ROTATION_DELAY_MS = 600;    // från 1500
const CAPTURE_DELAY_MS = 300;     // från 500

// I startScan():
await sleep(800); // Från 2000ms navigation wait

// Ny batch-loop:
const screenshots: string[] = [];
for (let rot = 0; rot < ROTATIONS_PER_POSITION; rot++) {
  const screenshot = await captureScreenshot();
  if (screenshot) screenshots.push(screenshot);
  if (rot < ROTATIONS_PER_POSITION - 1) {
    await rotateView(360 / ROTATIONS_PER_POSITION);
    await sleep(ROTATION_DELAY_MS);
  }
}
// Ett anrop för alla screenshots:
const detCount = await analyzeScreenshotBatch(screenshots, img?.id ?? null, position, img?.datasetName);
```

**`ai-asset-detection/index.ts` — ny action `analyze-screenshot-batch`:**
```typescript
case 'analyze-screenshot-batch': {
  const { screenshots, imageId, imagePosition, datasetName } = body;
  // Skicka alla bilder i ett Gemini multi-image prompt
  const parts = screenshots.map(b64 => ({ inlineData: { data: b64, mimeType: 'image/jpeg' } }));
  parts.unshift({ text: promptText });
  const result = await gemini.generateContent({ contents: [{ role: 'user', parts }] });
  // ... parse result
}
```

---

## 3. ACC-integration — röd felkod

### Nulägesanalys

Felet uppstod efter att "Testa koppling" och andra knappar togs bort och ersattes med den förenklade "Fler åtgärder"-strukturen.

**Identifierat problem i `useEffect` på rad 678–691:**
```typescript
useEffect(() => {
  if (isOpen && accAuthStatus !== 'checking' && !hasLoadedAccSettings) {
    setHasLoadedAccSettings(true);
    handleCheckAccStatus();
    // Auto-fetch hubs if not already loaded
    if (accHubs.length === 0) {
      handleFetchHubs(); // ← Anropar list-hubs direkt
    }
    // Auto-fetch folders if project is selected but no folders cached
    if ((manualAccProjectId.trim() || selectedAccProjectId) && accFolders === null) {
      handleFetchAccFolders(); // ← Anropar list-folders direkt
    }
  }
}, [isOpen, accAuthStatus, hasLoadedAccSettings]);
```

`handleFetchHubs()` anropar `acc-sync` med `{ action: 'list-hubs' }`. `handleFetchAccFolders()` anropar `acc-sync` med `{ action: 'list-folders' }`.

**Felet:** `list-hubs` kräver en giltig 3-legged OAuth-token (Autodesk-inloggning). Om `accAuthStatus === 'unauthenticated'` men `hasLoadedAccSettings` is false → useEffect triggas, `handleFetchHubs()` anropas → edge function misslyckas → röd toast-error.

**Orsaken till att det fungerade innan:** Tidigare hade vi en "Testa anslutning"-knapp som bara användes manuellt. Nu sker `handleFetchHubs()` automatiskt vid modal-öppning.

**Fix:**
1. Lägg till check: auto-fetch hubs bara om `accAuthStatus === 'authenticated'`
2. Visa tydligare info-state i UI:t när Autodesk ej är inloggad — istället för att misslyckas tyst

```typescript
// Nuvarande (fel):
if (accHubs.length === 0) {
  handleFetchHubs();
}

// Fix:
if (accHubs.length === 0 && accAuthStatus === 'authenticated') {
  handleFetchHubs();
}
if ((manualAccProjectId.trim() || selectedAccProjectId) && accFolders === null && accAuthStatus === 'authenticated') {
  handleFetchAccFolders();
}
```

**Dessutom:** I `handleFetchHubs()` och `handleFetchAccFolders()` hanteras fel med `toast({ variant: 'destructive', ... })` som visar röda felmeddelanden. Dessa visas nu automatiskt vid modal-öppning. Fix: lägg till `if (!data?.success && accAuthStatus !== 'authenticated') return;` som tyst ignorerar felet när Autodesk ej är inloggad.

### Konkreta filändringar

**`src/components/settings/ApiSettingsModal.tsx` — rad 678–691:**
```typescript
useEffect(() => {
  if (isOpen && accAuthStatus !== 'checking' && !hasLoadedAccSettings) {
    setHasLoadedAccSettings(true);
    handleCheckAccStatus();
    // Auto-fetch hubs ONLY if authenticated — avoids red error toast when not logged in
    if (accHubs.length === 0 && accAuthStatus === 'authenticated') {
      handleFetchHubs();
    }
    // Auto-fetch folders ONLY if authenticated and project selected
    if ((manualAccProjectId.trim() || selectedAccProjectId) && accFolders === null && accAuthStatus === 'authenticated') {
      handleFetchAccFolders();
    }
  }
}, [isOpen, accAuthStatus, hasLoadedAccSettings]);
```

**`handleFetchHubs` (rad ~700–724) — stilla fel om ej inloggad:**
```typescript
const handleFetchHubs = async () => {
  if (accAuthStatus !== 'authenticated') return; // Guard
  // ... resten oförändrad
};
```

**`handleFetchAccFolders` (rad ~726–754) — detsamma:**
```typescript
const handleFetchAccFolders = async () => {
  if (accAuthStatus !== 'authenticated') {
    toast({ variant: 'destructive', title: 'Autodesk ej inloggad', description: 'Logga in med ditt Autodesk-konto först.' });
    return;
  }
  // ... resten oförändrad
};
```

---

## Filer att ändra

| Fil | Ändringar |
|-----|-----------|
| `src/components/viewer/AssetPlusViewer.tsx` | NavCube-offset på mobil, dölj FloorCarousel på mobil, identifiera banner |
| `src/components/viewer/ViewerRightPanel.tsx` | Sheet `side="bottom"` + `max-h-[70vh]` på mobil |
| `src/components/viewer/MobileViewerOverlay.tsx` | Inga ändringar behövs |
| `src/components/ai-scan/BrowserScanRunner.tsx` | Reducera delays, batch-screenshots (3 rotationer, kortare waits) |
| `supabase/functions/ai-asset-detection/index.ts` | Ny `analyze-screenshot-batch` action för multi-image Gemini-anrop |
| `src/components/settings/ApiSettingsModal.tsx` | Auto-fetch-guard med `accAuthStatus === 'authenticated'` |

## Prioritetsordning

1. **ACC-felet** (10 min) — enkelt, tydlig rotorsak, stoppar användaren från att öppna inställningar utan röda fel
2. **Mobil 3D** (30 min) — responsivitet, NavCube, dölj FloorCarousel, kompakta paneler
3. **AI-scan batch-optimering** (45 min) — 8x prestandaförbättring

## Vad ingår inte

- E57-parsning: avråds, kräver nytt server-pipeline och hanterar 10–50 GB filer
- Spatial sampling per 3D-koordinat: komplext, låg prioritet
- Senslinc/ACC-duplikat/Insights-karta: hanteras i separata issues
