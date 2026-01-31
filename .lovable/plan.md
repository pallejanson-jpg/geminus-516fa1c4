

# Plan: Fixa AI-skanning - 0 detektioner, batchstorlek och mobilt UI

## Identifierade problem

### Problem 1: AI-skanningen hittar ingenting
**Orsak:** Bildnedladdningen misslyckas med "Callback URL failed: 404"

Loggarna visar:
```
Download hop 2: https://swg.iv.navvis.com/api/storage/signed/callback/.../00047-pano.jpg
Status: 302
Callback URL returned 404, trying with auth...
With auth: 404
Error processing image 47: Error: Callback URL failed: 404
```

Ivion returnerar en redirect (302) till en callback-URL, men denna URL ger sedan 404. Detta är troligen ett autentiserings- eller åtkomstproblem med Ivion.

**Lösning:** Uppdatera `downloadImageAsBase64()` för att:
1. Följa redirect-kedjan korrekt
2. Logga mer detaljerad felsökning
3. Hoppa över felaktiga bilder utan att stoppa hela batchen

### Problem 2: Batchstorleken är för liten (3 bilder)
**Orsak:** `batchSize = 3` på rad 981

**Lösning:** Öka batchstorleken från 3 till **25** bilder per batch. Med ~100 bilder behövs då bara 4 klick istället för 33.

Alternativt: Implementera **automatisk batch-fortsättning** som kör tills allt är klart.

### Problem 3: total_images är 10000 (fel)
**Orsak:** Standardvärdet är för högt och uppskattningen körs inte korrekt.

**Lösning:** 
1. Sätt bättre initial uppskattning baserat på verkligt probing
2. Uppdatera `total_images` från faktiska bilder hittade, inte multiplikation

### Problem 4: Delete-knappen svår att se på mobil
**Orsak:** Knappen är liten (8x8) och grå mot grå bakgrund.

**Lösning:** Gör knappen större på mobil och med tydligare färg/kontrast.

---

## Del 1: Förbättra bildnedladdning

### Fil: `supabase/functions/ai-asset-detection/index.ts`

**Uppdatera `downloadImageAsBase64()`:**

```typescript
async function downloadImageAsBase64(url: string): Promise<string> {
  const token = await getIvionToken();
  
  // Try direct download first without following redirects manually
  console.log(`Attempting direct download: ${url.slice(0, 100)}...`);
  
  try {
    // Method 1: Let fetch handle redirects automatically
    const directResponse = await fetch(url, {
      headers: { 'x-authorization': `Bearer ${token}` },
      redirect: 'follow', // Let browser/deno handle redirects
    });
    
    if (directResponse.ok) {
      console.log(`Direct download successful! Type: ${directResponse.headers.get('content-type')}`);
      return bufferToBase64(await directResponse.arrayBuffer());
    }
  } catch (e) {
    console.log(`Direct download failed: ${e}`);
  }
  
  // Method 2: Try alternative URL patterns
  const alternativePatterns = [
    url.replace('/storage/redirect/', '/data/'),
    url.replace('/api/site/', '/data/'),
  ];
  
  for (const altUrl of alternativePatterns) {
    try {
      const response = await fetch(altUrl, {
        headers: { 'x-authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        console.log(`Alternative URL worked: ${altUrl.slice(0, 80)}...`);
        return bufferToBase64(await response.arrayBuffer());
      }
    } catch {}
  }
  
  throw new Error(`Failed to download image from any URL pattern`);
}
```

---

## Del 2: Öka batchstorlek och lägg till auto-fortsättning

### Fil: `supabase/functions/ai-asset-detection/index.ts`

**Ändra standardbatchstorlek:**

```typescript
// Rad 981
const batchSize = params.batchSize || 25; // Ökat från 3 till 25
```

### Fil: `src/components/ai-scan/ScanProgressPanel.tsx`

**Lägg till automatisk batch-fortsättning:**

```typescript
// Ny state
const [autoProcess, setAutoProcess] = useState(false);

// Modifiera processBatch för att fortsätta automatiskt
useEffect(() => {
  if (autoProcess && currentJob && currentJob.status === 'running' && !isProcessing) {
    // Vänta lite mellan batchar
    const timer = setTimeout(() => {
      processBatch();
    }, 1000);
    return () => clearTimeout(timer);
  }
}, [autoProcess, currentJob?.processed_images, isProcessing]);

// Uppdatera knapp-UI
<Button onClick={() => setAutoProcess(!autoProcess)}>
  {autoProcess ? (
    <>
      <Pause className="h-4 w-4 mr-2" />
      Pausa automatisk körning
    </>
  ) : (
    <>
      <Play className="h-4 w-4 mr-2" />
      Kör automatiskt
    </>
  )}
</Button>
```

---

## Del 3: Fixa total_images-uppskattning

### Fil: `supabase/functions/ai-asset-detection/index.ts`

**Uppdatera startScan:**

Sätt `total_images` till 0 initialt och låt probing-logiken uppdatera det:

```typescript
// I startScan()
const { data: job, error } = await supabase
  .from('scan_jobs')
  .insert({
    building_fm_guid: params.buildingFmGuid,
    ivion_site_id: params.ivionSiteId,
    templates: params.templates,
    status: 'queued',
    created_by: params.userId,
    total_images: 0,  // Startar på 0, uppdateras vid probing
  })
  .select()
  .single();
```

**Förbättra uppdateringslogiken i processBatch:**

```typescript
// Efter att ha probat första dataset
if (job.total_images === 0 && images.length > 0) {
  // Snabb scan av ALLA datasets för att få rätt totalantal
  let totalEstimate = 0;
  for (const ds of datasets) {
    // Quick HEAD probe to estimate
    const count = await quickProbeDatasetCount(job.ivion_site_id, ds.name);
    totalEstimate += count;
  }
  await supabase.from('scan_jobs').update({ total_images: totalEstimate }).eq('id', job.id);
}
```

---

## Del 4: Förbättra mobilt UI för delete-knappen

### Fil: `src/components/ai-scan/ScanProgressPanel.tsx`

**Gör delete-knappen tydligare på mobil:**

```typescript
{canDeleteJob(job.status) && (
  <Button
    variant="ghost"
    size="icon"
    className={cn(
      "shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10",
      isMobile ? "h-10 w-10" : "h-8 w-8"  // Större på mobil
    )}
    onClick={() => setDeleteJobId(job.id)}
  >
    <Trash2 className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />
  </Button>
)}
```

**Förbättra listan med tydligare struktur:**

```typescript
// Tidigare skanningar på mobil
<div className="flex flex-col gap-2 p-3 bg-muted/50 rounded-lg">
  {/* Rad 1: Status + mallar */}
  <div className="flex items-center gap-2">
    {getStatusBadge(job.status)}
    <span className="text-sm font-medium truncate flex-1">
      {job.templates.join(', ')}
    </span>
  </div>
  
  {/* Rad 2: Datum + statistik */}
  <div className="flex items-center text-xs text-muted-foreground gap-2">
    <span>{new Date(job.created_at).toLocaleDateString('sv-SE')}</span>
    <span>•</span>
    <span className="font-medium text-foreground">{job.detections_found} hittade</span>
    <span>•</span>
    <span>{job.processed_images}/{job.total_images || '?'} bilder</span>
  </div>
  
  {/* Rad 3: Knappar (endast på mobil för tydlighet) */}
  {canDeleteJob(job.status) && (
    <Button
      variant="outline"
      size="sm"
      className="w-full mt-1 text-destructive border-destructive/30 hover:bg-destructive/10"
      onClick={() => setDeleteJobId(job.id)}
    >
      <Trash2 className="h-4 w-4 mr-2" />
      Ta bort skanning
    </Button>
  )}
</div>
```

---

## Teknisk sammanfattning

| Fil | Åtgärd | Beskrivning |
|-----|--------|-------------|
| `supabase/functions/ai-asset-detection/index.ts` | Ändra | Förbättra bildnedladdning, öka batch till 25 |
| `src/components/ai-scan/ScanProgressPanel.tsx` | Ändra | Automatisk körning, tydligare mobilt UI |

### Batchstorlek

| Nuvarande | Nytt |
|-----------|------|
| 3 bilder/batch | 25 bilder/batch |
| ~33 klick för 100 bilder | ~4 klick för 100 bilder |
| Ingen auto-fortsättning | Auto-fortsättning tillgänglig |

### Felsökning av bildnedladdning

Problemet är att NavVis/Ivion returnerar redirect-kedjor som leder till 404. Lösningen provar flera URL-mönster:
1. Direktnedladdning med `redirect: 'follow'`
2. Alternativa URL-mönster (`/data/` istället för `/storage/redirect/`)
3. Detaljerad loggning för att identifiera exakt var felet uppstår

### Mobilt UI

Innan:
```
[Badge] Templates...     [🗑️ liten grå]
```

Efter:
```
┌─────────────────────────────────────┐
│ [Badge: Klar] Brandsläckare         │
│ 2026-01-31 • 45 hittade • 120 bilder│
│ ┌─────────────────────────────────┐ │
│ │ 🗑️ Ta bort skanning            │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

---

## Testplan

1. **Bildnedladdning**
   - Starta en ny skanning
   - Kontrollera loggarna för nedladdningsframgång
   - Verifiera att AI-analysen körs och hittar objekt

2. **Batchstorlek**
   - Klicka "Bearbeta nästa batch"
   - Verifiera att 25 bilder bearbetas (inte 3)
   - Testa "Kör automatiskt" för kontinuerlig bearbetning

3. **Mobilt UI**
   - Öppna på mobil (390px)
   - Verifiera att "Ta bort skanning"-knappen är tydlig
   - Klicka och bekräfta borttagning

