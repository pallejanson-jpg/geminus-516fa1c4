

# Plan: Fixa AI-skanningssidan för mobil och lägg till automatiskt foto

## Identifierade problem

Efter undersökning av koden och databasen har jag hittat följande:

### 1. Gamla skanningar fastnar på "Pågår"
Det finns 10 gamla scan_jobs i databasen med `status: 'running'` som aldrig avslutades. Dessa visas som pågående trots att ingen bearbetning sker. Problemet är att:
- Systemet saknar logik för att automatiskt markera gamla jobb som övergivna
- Avbryt-knappen finns men syns kanske inte på mobil

### 2. Mobilt UI överlappar
- Tab-raden med 4 tabs (`Konfigurera`, `Skanning`, `Granska`, `Mallar`) blir för trång på 390px bredd
- Text och badges överlappar varandra
- Korten i `Tidigare skanningar` är för trånga

### 3. Avbryt/Ta bort syns inte på mobil
- Avbryt-knappen finns i koden men layouten gör den svår att se/nå
- Papperskorgen för att ta bort gamla skanningar finns men syns dåligt

### 4. Inget automatiskt foto sparas
- AI:n identifierar objekt och sparar en thumbnail
- Men denna thumbnail länkas inte till tillgången när den godkänns
- Användaren vill ha ett beskuret foto med marginal automatiskt sparat

---

## Del 1: Åtgärda mobilt UI

### Fil: `src/pages/AiAssetScan.tsx`

**Ändringar:**
- Gör tabs responsiva med ikoner utan text på mobil
- Använd `useIsMobile()` för att anpassa layout
- Komprimera header på mobil

```text
Desktop tabs:
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ 🏢 Konfigurera│ 🔄 Skanning  │ ✓ Granska   │ ⚙ Mallar    │
└──────────────┴──────────────┴──────────────┴──────────────┘

Mobil tabs:
┌──────────┬──────────┬──────────┬──────────┐
│    🏢    │    🔄    │    ✓     │    ⚙    │
│Konfigurera│ Skanning │ Granska  │  Mallar  │
└──────────┴──────────┴──────────┴──────────┘
```

### Fil: `src/components/ai-scan/ScanProgressPanel.tsx`

**Ändringar:**
- Responsiv layout för aktiv skanning-kortet
- Stapla knappar vertikalt på mobil
- Responsiv layout för "Tidigare skanningar"-listan
- Tydligare papperskorg för borttagning

```text
Mobil layout för tidigare skanningar:
┌─────────────────────────────────────────┐
│ [Badge: Klar] Brandsläckare, Nöduggång │
│ 2026-01-31 10:30                        │
│ 45 hittade | 120 bilder         [🗑️]   │
└─────────────────────────────────────────┘
```

---

## Del 2: Automatisk avslutning av övergivna skanningar

### Fil: `supabase/functions/ai-asset-detection/index.ts`

**Ny funktion: `cleanupStaleScanJobs()`**

Körs automatiskt vid `get-scan-jobs` för att markera gamla jobb som övergivna:
- Skanningar med status `running` som inte uppdaterats på >30 minuter → sätt till `failed`
- Skanningar med status `queued` som skapats för >1 timme sedan → sätt till `cancelled`

```typescript
async function cleanupStaleScanJobs(): Promise<number> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Mark stale running jobs as failed (no update in 30 min)
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  
  const { data: staleRunning } = await supabase
    .from('scan_jobs')
    .update({ 
      status: 'failed', 
      error_message: 'Automatiskt avbruten - ingen aktivitet på 30 minuter',
      completed_at: new Date().toISOString()
    })
    .eq('status', 'running')
    .lt('started_at', thirtyMinAgo)
    .is('completed_at', null)
    .select('id');
  
  return staleRunning?.length || 0;
}
```

---

## Del 3: Förbättra avbryt-funktionen på mobil

### Fil: `src/components/ai-scan/ScanProgressPanel.tsx`

**Ändringar:**
- Gör Avbryt-knappen tydligare och röd på mobil
- Placera den på en egen rad under progress
- Lägg till bekräftelse-dialog innan avbrytning

```text
Mobil layout för aktiv skanning:
┌─────────────────────────────────────────┐
│ 🔄 Aktiv skanning          [Badge: Pågår]│
│ Söker efter: Brandsläckare              │
├─────────────────────────────────────────┤
│ ▓▓▓▓▓▓▓▓░░░░░░░░░░░ 45%               │
│ 45 / 100 bilder                         │
├─────────────────────────────────────────┤
│ [▶ Bearbeta nästa batch]                │
│ [⏹ Avbryt skanning] (röd)              │
└─────────────────────────────────────────┘
```

---

## Del 4: Spara beskuret foto automatiskt

### Fil: `supabase/functions/ai-asset-detection/index.ts`

**Ändring i `saveThumbnail()`:**
- Lägg till 20% marginal runt bounding box
- Spara som högre kvalitet för användning som asset-foto

**Ändring i `approveDetection()`:**
- Kopiera `thumbnail_url` från `pending_detections` till `assets.attributes.imageUrl`
- Detta gör att fotot automatiskt visas i tillgångsvisningen

```typescript
// I approveDetection()
const attributes: Record<string, any> = {
  ai_detected: true,
  ai_confidence: detection.confidence,
  ai_description: detection.ai_description,
  imageUrl: detection.thumbnail_url, // <-- NY: Automatiskt foto
};
```

---

## Teknisk sammanfattning

### Filer som ändras

| Fil | Åtgärd | Beskrivning |
|-----|--------|-------------|
| `src/pages/AiAssetScan.tsx` | Ändra | Responsiv header och tabs för mobil |
| `src/components/ai-scan/ScanProgressPanel.tsx` | Ändra | Responsiv layout + tydligare avbryt/ta bort |
| `supabase/functions/ai-asset-detection/index.ts` | Ändra | Auto-cleanup + spara thumbnail till asset |

### Marginalbeskärning för thumbnail

Nuvarande kod:
```typescript
saveThumbnail(base64, bbox, detectionId)
```

Ny logik med marginal:
```typescript
// Lägg till 20% marginal runt objektet
const margin = 0.2;
const expandedBbox = {
  ymin: Math.max(0, bbox.ymin - (bbox.ymax - bbox.ymin) * margin),
  xmin: Math.max(0, bbox.xmin - (bbox.xmax - bbox.xmin) * margin),
  ymax: Math.min(1000, bbox.ymax + (bbox.ymax - bbox.ymin) * margin),
  xmax: Math.min(1000, bbox.xmax + (bbox.xmax - bbox.xmin) * margin),
};
saveThumbnail(base64, expandedBbox, detectionId)
```

### Asset med automatiskt foto

```json
{
  "fm_guid": "uuid...",
  "name": "Gloria PD6GA 6kg",
  "attributes": {
    "ai_detected": true,
    "ai_confidence": 0.94,
    "imageUrl": "https://.../detection-thumbnails/uuid.jpg",  // <-- NYTT
    "brand": "Gloria",
    "model": "PD6GA"
  }
}
```

---

## Databasen: Rensa gamla skanningar

Jag kommer också automatiskt markera de 10 gamla "running"-jobben som misslyckade vid första anropet till `get-scan-jobs`.

---

## Testplan

1. **Mobilt UI**
   - Öppna `/inventory/ai-scan` på mobilvy (390px)
   - Verifiera att tabs inte överlappar
   - Verifiera att tidigare skanningar-listan är läsbar

2. **Avbryt skanning**
   - Starta en skanning
   - Verifiera att Avbryt-knappen är tydlig och röd
   - Klicka Avbryt och bekräfta att jobbet avslutas

3. **Ta bort gamla skanningar**
   - Verifiera att gamla skanningar nu visas som "Misslyckades"
   - Klicka på papperskorgen för att ta bort
   - Verifiera borttagning

4. **Automatiskt foto**
   - Kör en skanning på en byggnad
   - Godkänn en detektion
   - Verifiera att den skapade tillgången har ett foto i `attributes.imageUrl`

