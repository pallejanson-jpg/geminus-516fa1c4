
# Plan: Mobilkamera-inventering + Ivion UI-minimering för skanning

## Del 1: Mobilkamera-inventering med Gemini Vision

### Hur det fungerar idag
Mobilinventeringswizarden har 5 steg: detection → location → category → position → registration. Användaren väljer kategori manuellt och anger namn för hand.

### Ny feature: "Foto-skanning" — ett valfritt steg
Användaren tar ett foto INNAN kategori-steget. Gemini Vision analyserar fotot och föreslår:
- Objekttyp (kategori)
- Namn/beteckning
- Symbol att använda
- Egenskaper (färg, märke, skick)

Flödet blir:
```text
detection → location → [NYTT: photo-scan] → category (förifylld) → position → registration (förifylld)
```

Photo-scan-steget är frivilligt — användaren kan hoppa över det direkt till category som idag.

### Teknisk implementation

#### 1. Ny edge function: `mobile-ai-scan`
Enkel, dedikerad edge function som tar emot en base64-bild och returnerar objektidentifiering.

**`supabase/functions/mobile-ai-scan/index.ts`** (ny fil):
- Tar emot `{ imageBase64, templateNames? }` 
- Hämtar aktiva detection templates från databasen
- Skickar bild + templates + few-shot examples till `google/gemini-3-flash-preview`
- Returnerar `{ objectType, suggestedName, symbolId, confidence, properties }`

Lägg till i `config.toml`:
```toml
[functions.mobile-ai-scan]
verify_jwt = false
```

#### 2. Nytt wizard-steg: `PhotoScanStep`
**`src/components/inventory/mobile/PhotoScanStep.tsx`** (ny fil):

```text
┌─────────────────────────────────────┐
│  📷  Fotografera objektet           │
│                                     │
│  ┌───────────────────────────────┐  │
│  │                               │  │
│  │   [Ta foto / Välj bild]       │  │
│  │                               │  │
│  └───────────────────────────────┘  │
│                                     │
│  AI identifierar objekttyp          │
│  automatiskt från fotot             │
│                                     │
│  [Hoppa över →]                     │
└─────────────────────────────────────┘
```

När bild tagits:
- Visar laddningsindikator: "Identifierar objekt..."
- Vid success: visar detektionsresultat med ikon och confidence
- Förifyllar `formData.category`, `formData.categoryLabel`, `formData.name`, `formData.symbolId`
- Går automatiskt vidare till position-steget (hoppar category)

Om AI:n inte är säker (confidence < 0.5): visar förslaget men låter användaren korrigera i category-steget.

#### 3. Uppdatera `MobileInventoryWizard.tsx`
- Lägg till `'photo-scan'` som nytt steg mellan `'location'` och `'category'`
- `STEP_ORDER: ['detection', 'location', 'photo-scan', 'category', 'position', 'registration']`
- Ny stegindikator-ikon: `Sparkles` (AI-ikon)
- Om photo-scan ger hög confidence (> 0.7): hoppa automatiskt förbi category-steget
- Uppdatera `WizardFormData` med `aiSuggestionConfidence?: number`

#### 4. Uppdatera `QuickRegistrationStep.tsx`
- Om `formData.imageUrl` redan är satt från photo-scan: visa bilden direkt (ingen ny bildknapp)
- Lägg till en liten "AI-föreslagen" badge vid kategori/namn om de kom från AI:n

### AI-prompt för mobilkamera
Enkelt och fokuserat — identifiera ett enskilt objekt (inte batch):

```typescript
system: `You are an expert at identifying building equipment and assets from photos taken during facility management inspections. Return ONLY valid JSON.`

user: `Identify the main object in this photo. Return JSON with:
- objectType: one of [fire_extinguisher, fire_alarm_button, smoke_detector, fire_hose, electrical_panel, door, elevator, staircase, ventilation, other]
- suggestedName: a short descriptive name in Swedish (e.g. "Brandsläckare 6kg", "Larmknapp plan 2")
- confidence: 0.0-1.0
- properties: { brand, model, size, color, condition, text_visible }
- category: one of [Brandskydd, El, VVS, Ventilation, Dörrar, Transporter, Övrigt]`
```

---

## Del 2: Ivion UI-minimering för skanning

### Problemet
Ivions inbyggda UI-element (sidomeny, kontrollknappar, våningsväljare, informationspaneler) täcker delar av panoramabilden när `BrowserScanRunner` tar screenshots. Det minskar bildytan som Gemini ser.

### Vad kan göras via SDK + CSS

Från `ivion-sdk.ts` ser vi att:
- `iv.getMenuItems()?.forEach(item => item.setVisible(false))` — döljer sidomenyobjekt
- `iv.closeMenu?.()` — stänger sidomenyn

Det saknas dock CSS-injicering specifikt för scan-läget. Vi lägger till det i `BrowserScanRunner` när SDK:n är redo.

#### CSS-injicering i `BrowserScanRunner.tsx`
När `sdkStatus === 'ready'`, injicera CSS i `<ivion>` shadow DOM eller direkt på containern:

```typescript
// I useEffect när sdkStatus === 'ready':
const injectScanCSS = () => {
  const style = document.createElement('style');
  style.id = 'ivion-scan-minimal-ui';
  style.textContent = `
    /* Hide all Ivion UI controls during scan */
    ivion [class*="sidebar"],
    ivion [class*="menu"],
    ivion [class*="toolbar"],
    ivion [class*="controls"],
    ivion [class*="floor-switcher"],
    ivion [class*="navigation"],
    ivion [class*="info-panel"],
    ivion [class*="minimap"],
    ivion button,
    ivion .mat-icon-button,
    ivion mat-sidenav,
    ivion mat-toolbar {
      display: none !important;
      visibility: hidden !important;
    }
    /* Ensure canvas fills container */
    ivion canvas {
      width: 100% !important;
      height: 100% !important;
    }
  `;
  document.head.appendChild(style);
};
```

Rensa upp CSS när komponenten avmonteras (`return () => document.getElementById('ivion-scan-minimal-ui')?.remove()`).

#### Också: Dölj via SDK API
I `useEffect` när `sdkStatus === 'ready'`:
```typescript
const api = ivApiRef.current;
try {
  // Hide all menu items
  api.getMenuItems?.()?.forEach(item => item.setVisible?.(false));
  api.closeMenu?.();
  // Try to set fullscreen panorama mode
  const mainView = api.view?.mainView ?? api.getMainView?.();
  mainView?.setFullscreen?.(true);
} catch (e) { /* ignore */ }
```

### Tekniska filändringar

| Fil | Ändring |
|-----|---------|
| `supabase/functions/mobile-ai-scan/index.ts` | Ny edge function för AI-identifiering av enskilda objekt |
| `supabase/config.toml` | Lägg till `[functions.mobile-ai-scan] verify_jwt = false` |
| `src/components/inventory/mobile/PhotoScanStep.tsx` | Nytt wizard-steg med kamera + Gemini Vision |
| `src/components/inventory/mobile/MobileInventoryWizard.tsx` | Lägg till photo-scan i STEP_ORDER och stegindikator |
| `src/components/ai-scan/BrowserScanRunner.tsx` | CSS-injicering + SDK API-anrop för att dölja Ivion UI vid skanning |

### Flödesdiagram

```text
MobileInventoryWizard
  detection
    ↓
  location
    ↓
  photo-scan (NYTT)
    ├─ [Hoppa över] → category → position → registration
    ├─ [confidence < 0.5] → category (AI förslag synligt men redigerbart)
    └─ [confidence ≥ 0.7] → position (category auto-ifyllt, hoppar steget)
    
BrowserScanRunner (BEFINTLIG)
  SDK ready → inject CSS (dölj Ivion controls)
           → SDK API (closeMenu, setVisible false)
           → Ta screenshots utan UI-brus
```

### Prioritering
Del 2 (Ivion UI-minimering) är en liten ändring i en befintlig fil och implementeras snabbt. Del 1 (mobilkamera) kräver ny edge function + ny komponent + wizard-uppdatering. Båda implementeras i samma iteration.
