

# Phase 2: Implementera bildnedladdning och Gemini Vision AI-analys

## Översikt

Denna fas fokuserar på att implementera den faktiska bildbearbetningen och AI-detektionen i `processBatch`-funktionen. Systemet ska:

1. Hämta dataset-lista och bildinformation från NavVis IVION
2. Ladda ner panoramabilder och konvertera till base64
3. Analysera varje bild med Gemini Vision AI
4. Spara detektioner med thumbnail-bilder i review-kön

## Nuvarande status

Edge function `ai-asset-detection` har redan:
- Token-hantering och autentisering mot NavVis IVION
- `getIvionDatasets()` - hämtar dataset-lista
- `getPanoramaImageUrl()` - probar URL-mönster
- `downloadImageAsBase64()` - laddar ner bild
- `analyzeImageWithAI()` - anropar Gemini Vision
- `imageToWorldCoords()` - konverterar 2D till 3D

Men `processBatch()` är fortfarande en stub som inte gör något med bilderna.

## Teknisk implementation

### 1. Hämta bilder från NavVis dataset

NavVis IVION lagrar panoramabilder i "datasets" (skanningar). För varje dataset behöver vi:

```text
GET /api/site/{site_id}/datasets → Lista dataset
GET /api/site/{site_id}/datasets/{dataset_id}/images → Lista bilder med metadata
GET /api/site/{site_id}/storage/redirect/... → Hämta bilddata
```

### 2. Uppdaterad `processBatch()` logik

```text
┌─────────────────────────────────────────────────────────────────┐
│                       processBatch()                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Hämta scan job och templates                                │
│  2. Hämta dataset-lista från IVION                              │
│  3. För varje dataset (med resume-stöd):                        │
│     a. Hämta bild-lista med positionsdata                       │
│     b. Ladda ner batchSize bilder (5 st per anrop)              │
│     c. För varje bild:                                          │
│        - Ladda ner som base64                                   │
│        - Skicka till Gemini Vision                              │
│        - Parse detektioner                                      │
│        - Räkna om 3D-koordinater                                │
│        - Skapa thumbnails                                       │
│        - Spara i pending_detections                             │
│     d. Uppdatera job-progress                                   │
│  4. Om alla bilder processade → status = "completed"            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Ny funktion: `getDatasetImages()`

Hämtar bildinformation inklusive kameraposition för 3D-beräkning:

```typescript
async function getDatasetImages(siteId: string, datasetId: number): Promise<IvionImage[]> {
  const token = await getIvionToken();
  const response = await fetch(`${IVION_API_URL}/api/site/${siteId}/datasets/${datasetId}/images`, {
    headers: { 'x-authorization': `Bearer ${token}` }
  });
  return response.json();
}
```

### 4. Thumbnail-generering

För att visa detekterade objekt i granskningen behövs en beskuren thumbnail:

```text
1. Ta originalbildens base64
2. Beräkna beskärningsområde från bounding box (med marginal)
3. Använd canvas API (för browser) eller sharp (för backend)
4. Spara till Supabase Storage bucket "detection-thumbnails"
5. Returnera offentlig URL
```

I edge function (Deno) kan vi använda Image manipulation bibliotek eller lagra hela panoramabilden temporärt och referera till bounding box.

### 5. Ändrad fil: `supabase/functions/ai-asset-detection/index.ts`

Uppdatera `processBatch()` med full implementation:

| Sektion | Ändring |
|---------|---------|
| `getDatasetImages()` | Ny funktion för att hämta bildlista med metadata |
| `createThumbnail()` | Ny funktion för att beskära och spara thumbnail |
| `processBatch()` | Fullständig implementation med bildnedladdning, AI-analys, och detection-sparande |

### 6. Felhantering och återupptagning

Systemet måste klara av:
- Token-utgång mitt i batch → auto-refresh
- Enstaka bild-nedladdningsfel → hoppa över, fortsätt
- Rate limits från AI Gateway → vänta och försök igen
- Timeout → spara progress, kan återupptas

```text
scan_job:
  current_dataset = "dataset_2023-05-15"
  current_image_index = 45
  → Nästa processBatch() fortsätter från bild 46
```

### 7. Alternativ bildåtkomst

NavVis IVION har olika sätt att tillhandahålla panoramabilder beroende på installation:

```text
Mönster 1: /api/site/{site}/storage/redirect/datasets_web/{dataset}/pano_high/{id}-pano.jpg
Mönster 2: /api/site/{site}/datasets/{id}/panorama?quality=high
Mönster 3: /data/{site}/datasets_web/{dataset}/pano_high/{id}-pano.jpg

Probing: Testa varje mönster tills ett fungerar, spara i job metadata
```

## Detaljerade kodändringar

### Fil: `supabase/functions/ai-asset-detection/index.ts`

#### Ny funktion: getDatasetImages
```typescript
async function getDatasetImages(siteId: string, datasetId: number | string): Promise<IvionImage[]> {
  const token = await getIvionToken();
  
  const response = await fetch(`${IVION_API_URL}/api/site/${siteId}/datasets/${datasetId}/images`, {
    headers: {
      'x-authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });
  
  if (!response.ok) {
    console.log(`Failed to get images for dataset ${datasetId}: ${response.status}`);
    return [];
  }
  
  return response.json();
}
```

#### Ny funktion: saveThumbnail
```typescript
async function saveThumbnail(
  imageBase64: string,
  boundingBox: { ymin: number; xmin: number; ymax: number; xmax: number },
  detectionId: string
): Promise<string | null> {
  // Spara hela bilden för nu (thumbnail-beskärning kräver bildbehandling)
  // Alternativt: spara bounding box info och låt frontend beskära
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const bytes = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
  const fileName = `${detectionId}.jpg`;
  
  const { error } = await supabase.storage
    .from('detection-thumbnails')
    .upload(fileName, bytes, {
      contentType: 'image/jpeg',
      upsert: true,
    });
  
  if (error) {
    console.error('Failed to save thumbnail:', error);
    return null;
  }
  
  const { data } = supabase.storage
    .from('detection-thumbnails')
    .getPublicUrl(fileName);
  
  return data.publicUrl;
}
```

#### Uppdaterad processBatch
```typescript
async function processBatch(params: {
  scanJobId: string;
  batchSize?: number;
}): Promise<{
  processed: number;
  detections: number;
  status: string;
  message: string;
}> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const batchSize = params.batchSize || 3; // Smaller batch for memory
  
  // 1. Get scan job
  const { data: job, error: jobError } = await supabase
    .from('scan_jobs')
    .select('*')
    .eq('id', params.scanJobId)
    .single();
  
  if (jobError || !job) throw new Error('Scan job not found');
  
  if (job.status === 'completed' || job.status === 'failed') {
    return { processed: job.processed_images, detections: job.detections_found, status: job.status, message: `Already ${job.status}` };
  }
  
  // 2. Set to running
  if (job.status === 'queued') {
    await supabase.from('scan_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', job.id);
  }
  
  // 3. Get templates
  const templates = await getTemplates();
  const activeTemplates = templates.filter(t => job.templates.includes(t.object_type));
  
  // 4. Get datasets
  const datasets = await getIvionDatasets(job.ivion_site_id);
  if (datasets.length === 0) {
    await supabase.from('scan_jobs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', job.id);
    return { processed: 0, detections: 0, status: 'completed', message: 'No datasets' };
  }
  
  // 5. Find resume point
  let startDatasetIndex = job.current_dataset ? datasets.findIndex(d => d.name === job.current_dataset) : 0;
  if (startDatasetIndex < 0) startDatasetIndex = 0;
  let startImageIndex = job.current_image_index || 0;
  
  let totalProcessed = job.processed_images || 0;
  let totalDetections = job.detections_found || 0;
  let imagesInBatch = 0;
  
  // 6. Process datasets
  for (let di = startDatasetIndex; di < datasets.length && imagesInBatch < batchSize; di++) {
    const dataset = datasets[di];
    const images = await getDatasetImages(job.ivion_site_id, dataset.id || dataset.name);
    
    // Update total count on first pass
    if (di === 0 && job.total_images === 0) {
      // Estimate total
      const estimatedTotal = datasets.length * images.length;
      await supabase.from('scan_jobs').update({ total_images: estimatedTotal }).eq('id', job.id);
    }
    
    const imageStart = di === startDatasetIndex ? startImageIndex : 0;
    
    for (let ii = imageStart; ii < images.length && imagesInBatch < batchSize; ii++) {
      const image = images[ii];
      
      try {
        // Download image
        const imageUrl = await getPanoramaImageUrl(job.ivion_site_id, dataset.name, image.id);
        if (!imageUrl) {
          console.log(`No URL found for image ${image.id}`);
          continue;
        }
        
        const base64 = await downloadImageAsBase64(imageUrl);
        
        // Analyze with AI
        const detections = await analyzeImageWithAI(base64, activeTemplates);
        
        // Save detections
        for (const det of detections) {
          const coords = imageToWorldCoords(
            { ymin: det.bounding_box[0], xmin: det.bounding_box[1], ymax: det.bounding_box[2], xmax: det.bounding_box[3] },
            image.pose?.position || { x: 0, y: 0, z: 0 }
          );
          
          const detectionId = crypto.randomUUID();
          const template = activeTemplates.find(t => t.object_type === det.object_type);
          
          // Save thumbnail (simplified - store bounding box for later cropping)
          const thumbnailUrl = await saveThumbnail(base64, {
            ymin: det.bounding_box[0], xmin: det.bounding_box[1],
            ymax: det.bounding_box[2], xmax: det.bounding_box[3]
          }, detectionId);
          
          await supabase.from('pending_detections').insert({
            id: detectionId,
            scan_job_id: job.id,
            building_fm_guid: job.building_fm_guid,
            ivion_site_id: job.ivion_site_id,
            ivion_dataset_name: dataset.name,
            ivion_image_id: image.id,
            detection_template_id: template?.id,
            object_type: det.object_type,
            confidence: det.confidence,
            bounding_box: { ymin: det.bounding_box[0], xmin: det.bounding_box[1], ymax: det.bounding_box[2], xmax: det.bounding_box[3] },
            coordinate_x: coords.x,
            coordinate_y: coords.y,
            coordinate_z: coords.z,
            thumbnail_url: thumbnailUrl,
            ai_description: det.description,
            status: 'pending',
          });
          
          totalDetections++;
        }
        
        totalProcessed++;
        imagesInBatch++;
        
      } catch (e) {
        console.error(`Error processing image ${image.id}:`, e);
        // Continue with next image
      }
      
      // Update progress
      await supabase.from('scan_jobs').update({
        current_dataset: dataset.name,
        current_image_index: ii + 1,
        processed_images: totalProcessed,
        detections_found: totalDetections,
      }).eq('id', job.id);
    }
    
    // Reset image index for next dataset
    startImageIndex = 0;
  }
  
  // Check if done
  const allDone = totalProcessed >= (job.total_images || 0);
  if (allDone) {
    await supabase.from('scan_jobs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('id', job.id);
  }
  
  return {
    processed: totalProcessed,
    detections: totalDetections,
    status: allDone ? 'completed' : 'running',
    message: `Processed ${imagesInBatch} images in this batch`
  };
}
```

## Sammanfattning av ändringar

| Fil | Ändringar |
|-----|-----------|
| `supabase/functions/ai-asset-detection/index.ts` | Lägg till `getDatasetImages()`, `saveThumbnail()`, uppdatera `processBatch()` med fullständig bildbearbetning |

## Förväntat resultat

Efter implementation:
1. Klicka "Starta skanning" i AI-skanningssidan
2. Systemet hämtar bilder från NavVis IVION
3. Gemini Vision analyserar varje panoramabild
4. Detekterade objekt sparas i pending_detections
5. Användaren kan granska och godkänna/avvisa i Review-fliken

## Risker och mitigeringar

| Risk | Mitigation |
|------|------------|
| Stora panoramabilder (5-10 MB) | Begränsa batchSize till 3, återuppta vid timeout |
| Token-utgång | Auto-refresh i getIvionToken() |
| AI rate limits | Fånga 429-fel, vänta 5 sek, försök igen |
| Inget bildåtkomstmönster fungerar | Visa tydligt felmeddelande i UI |

