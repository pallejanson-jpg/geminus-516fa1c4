
# Plan: Implementera bildprobing för NavVis IVION

## Bakgrund

Nuvarande implementation försöker hämta `poses.csv` från `/data/{siteId}/datasets_web/{name}/poses.csv` men detta returnerar 404 för alla 143 datasets.

### Verifierad information:
- **Dataset-listning fungerar** - 143 datasets hittas via API
- **Bildhämtning fungerar** - Test bekräftar att bilder kan nås via:
  ```
  /api/site/{siteId}/storage/redirect/datasets_web/{name}/pano/00000-pano.jpg
  ```
- **poses.csv saknas** - Filen exponeras inte på den förväntade platsen

## Lösning: Bildprobing

Eftersom metadata-filen inte är tillgänglig, implementera en probing-strategi som iterativt testar bildnamn tills en 404 returneras.

### Steg 1: Skapa `probeDatasetImages()` funktion

```text
┌─────────────────────────────────────────┐
│  Dataset: 2020-12-14_13.58.34           │
├─────────────────────────────────────────┤
│  Proba: 00000-pano.jpg  →  200 OK ✓     │
│  Proba: 00001-pano.jpg  →  200 OK ✓     │
│  Proba: 00002-pano.jpg  →  200 OK ✓     │
│  ...                                    │
│  Proba: 00157-pano.jpg  →  200 OK ✓     │
│  Proba: 00158-pano.jpg  →  404 STOP     │
├─────────────────────────────────────────┤
│  Resultat: 158 bilder hittade           │
└─────────────────────────────────────────┘
```

### Steg 2: Uppdatera `getDatasetImages()`

Fallback-logik:
1. Försök hämta poses.csv (för framtida kompatibilitet)
2. Om 404: använd probing-strategi
3. Returnera bildlista

### Steg 3: Begränsa probingen för prestanda

- Max 500 bilder per dataset (rimligt tak)
- Parallella requests (5-10 samtidigt) för snabbare discovery
- Cache resultat för att undvika upprepade probes

---

## Tekniska detaljer

### Ny funktion: `probeDatasetImages()`

```typescript
async function probeDatasetImages(
  siteId: string, 
  datasetName: string,
  maxImages: number = 500
): Promise<IvionImage[]> {
  const token = await getIvionToken();
  const images: IvionImage[] = [];
  const baseUrl = `${IVION_API_URL}/api/site/${siteId}/storage/redirect/datasets_web/${datasetName}/pano`;
  
  // Probe images in batches for performance
  const batchSize = 10;
  let index = 0;
  let consecutiveFailures = 0;
  
  while (index < maxImages && consecutiveFailures < 3) {
    // Create batch of probe requests
    const batch = [];
    for (let i = 0; i < batchSize && (index + i) < maxImages; i++) {
      const filename = `${String(index + i).padStart(5, '0')}-pano.jpg`;
      batch.push({ index: index + i, filename });
    }
    
    // Execute batch in parallel
    const results = await Promise.all(
      batch.map(async ({ index, filename }) => {
        const url = `${baseUrl}/${filename}`;
        try {
          const response = await fetch(url, {
            method: 'HEAD',
            headers: { 'x-authorization': `Bearer ${token}` },
            redirect: 'manual',
          });
          return { index, filename, exists: response.status === 200 || response.status === 302 };
        } catch {
          return { index, filename, exists: false };
        }
      })
    );
    
    // Process results
    for (const result of results) {
      if (result.exists) {
        images.push({
          id: result.index,
          filePath: result.filename,
          name: result.filename,
        });
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
      }
    }
    
    index += batchSize;
  }
  
  return images;
}
```

### Uppdaterad `getDatasetImages()`

```typescript
async function getDatasetImages(siteId: string, datasetName: string): Promise<IvionImage[]> {
  const token = await getIvionToken();
  
  // Try poses.csv first (for future compatibility)
  const posesUrl = `${IVION_API_URL}/data/${siteId}/datasets_web/${datasetName}/poses.csv`;
  
  try {
    const response = await fetch(posesUrl, {
      headers: { 'x-authorization': `Bearer ${token}` },
    });
    
    if (response.ok) {
      const csvText = await response.text();
      const images = parsePosesCsv(csvText);
      if (images.length > 0) {
        console.log(`Found ${images.length} images via poses.csv for ${datasetName}`);
        return images;
      }
    }
  } catch (e) {
    // poses.csv not available
  }
  
  // Fallback: probe for images
  console.log(`Probing for images in dataset ${datasetName}...`);
  const images = await probeDatasetImages(siteId, datasetName, 200);
  console.log(`Probed ${images.length} images for dataset ${datasetName}`);
  
  return images;
}
```

---

## Filer som ändras

| Fil | Ändringar |
|-----|-----------|
| `supabase/functions/ai-asset-detection/index.ts` | Lägg till `probeDatasetImages()`, uppdatera `getDatasetImages()` |

---

## Testplan

1. Deploya uppdaterad edge function
2. Starta ny AI-skanning på Centralstationen
3. Verifiera via loggar att:
   - Probing upptäcker bilder (t.ex. "Probed 158 images for dataset...")
   - AI-analys körs på bilderna
   - Detektioner sparas i pending_detections
4. Granska detektioner i UI

---

## Sammanfattning

| Problem | Lösning |
|---------|---------|
| poses.csv returnerar 404 | Fallback till probing-strategi |
| Okänt antal bilder per dataset | Proba 00000-pano.jpg, 00001-pano.jpg... tills 404 |
| Prestanda vid probing | Parallella requests (batch om 10) |
