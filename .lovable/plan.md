
# Plan: Fixa AI-skanningens bildhämtning från NavVis IVION

## Bakgrund

Nuvarande implementation i `ai-asset-detection` edge function misslyckas med att hämta panoramabilder från Ivion. Analysen visar:

1. **Autentisering fungerar** - Token hämtas korrekt via username/password
2. **Dataset-listning fungerar** - 143 datasets hittas för siteId `3045176558137335`
3. **Bildhämtning misslyckas** - `getDatasetImages()` returnerar 404 för alla datasets

### Rotorsak

Koden försöker använda ett felaktigt API-endpoint:
```
GET /api/site/{siteId}/datasets/{datasetId}/images  → 404 Not Found
```

Detta endpoint existerar **inte** i NavVis IVION REST API. Enligt NavVis dokumentation hämtas bildmetadata istället från en **statisk CSV-fil** (`poses.csv`) i varje dataset.

---

## Lösning

Implementera korrekt bildhämtning via NavVis statiska filstruktur:

### Steg 1: Läs poses.csv för bildmetadata

NavVis lagrar panoramabilders metadata i:
```
/data/{siteId}/datasets_web/{datasetName}/poses.csv
```

CSV-formatet:
```csv
# pano poses v1.0: ID; filename; timestamp; pano_pos_x; pano_pos_y; pano_pos_z; pano_ori_w; pano_ori_x; pano_ori_y; pano_ori_z
0; 00000-pano.jpg; 1455816514.953352; 0.150759; 0.050760; 1.855066; 0.999906; -0.013171; -0.001434; 0.003539
1; 00001-pano.jpg; 1455816529.513326; 0.026798; -0.029831; 1.858386; 0.734674; -0.003241; -0.014103; -0.678266
```

### Steg 2: Uppdatera getDatasetImages()

Ersätt den felaktiga API-anropet med CSV-parsning:

```typescript
async function getDatasetImages(siteId: string, datasetName: string): Promise<IvionImage[]> {
  const token = await getIvionToken();
  
  // Hämta poses.csv istället för API-anrop
  const posesUrl = `${IVION_API_URL}/data/${siteId}/datasets_web/${datasetName}/poses.csv`;
  
  const response = await fetch(posesUrl, {
    headers: {
      'x-authorization': `Bearer ${token}`,
    },
  });
  
  if (!response.ok) {
    console.log(`Failed to get poses for dataset ${datasetName}: ${response.status}`);
    return [];
  }
  
  const csvText = await response.text();
  return parsePosesCsv(csvText, datasetName);
}

function parsePosesCsv(csvText: string, datasetName: string): IvionImage[] {
  const lines = csvText.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  
  return lines.map(line => {
    const parts = line.split(';').map(s => s.trim());
    const [id, filename, timestamp, posX, posY, posZ, oriW, oriX, oriY, oriZ] = parts;
    
    return {
      id: parseInt(id),
      filePath: filename,
      name: filename,
      pose: {
        position: { x: parseFloat(posX), y: parseFloat(posY), z: parseFloat(posZ) },
        orientation: { 
          x: parseFloat(oriX), 
          y: parseFloat(oriY), 
          z: parseFloat(oriZ), 
          w: parseFloat(oriW) 
        }
      },
      timestamp: parseFloat(timestamp)
    };
  });
}
```

### Steg 3: Uppdatera getPanoramaImageUrl()

Använd korrekt URL-mönster baserat på `poses.csv`-filnamnet:

```typescript
async function getPanoramaImageUrl(
  siteId: string,
  datasetName: string,
  imageFilename: string // Nu filnamn istället för imageId
): Promise<string | null> {
  const token = await getIvionToken();
  
  // Primärt URL-mönster för equirectangular panorama
  const patterns = [
    // Fullstorlek panorama
    `${IVION_API_URL}/data/${siteId}/datasets_web/${datasetName}/pano/${imageFilename}`,
    // Alternativ: pano_high mapp
    `${IVION_API_URL}/data/${siteId}/datasets_web/${datasetName}/pano_high/${imageFilename}`,
    // Via storage redirect
    `${IVION_API_URL}/api/site/${siteId}/storage/redirect/datasets_web/${datasetName}/pano/${imageFilename}`,
  ];
  
  for (const url of patterns) {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: { 'x-authorization': `Bearer ${token}` },
      redirect: 'manual',
    });
    
    if (response.status === 200 || response.status === 302) {
      return url;
    }
  }
  
  return null;
}
```

### Steg 4: Uppdatera processBatch()

Anpassa batch-processningen för att använda korrekta filnamn:

```typescript
// Ändra anropet till getDatasetImages
images = await getDatasetImages(job.ivion_site_id, dataset.name); // Skicka name, inte id

// Ändra anropet till getPanoramaImageUrl
const imageUrl = await getPanoramaImageUrl(
  job.ivion_site_id, 
  dataset.name, 
  image.filePath || `${String(image.id).padStart(5, '0')}-pano.jpg`
);
```

---

## Tekniska detaljer

### Filstruktur i NavVis IVION
```
/data/{siteId}/datasets_web/{datasetName}/
├── poses.csv           ← Bildmetadata (ID, position, orientering)
├── pano/               ← Panoramabilder (equirectangular)
│   ├── 00000-pano.jpg
│   ├── 00001-pano.jpg
│   └── ...
├── pano_high/          ← Högupplösta versioner (alternativ)
│   └── ...
└── cloud/              ← Punktmoln (används ej för AI-skanning)
    ├── metadata.json
    └── hierarchy.bin
```

### Filer som ändras

| Fil | Ändringar |
|-----|-----------|
| `supabase/functions/ai-asset-detection/index.ts` | Uppdatera `getDatasetImages()`, `getPanoramaImageUrl()`, `processBatch()` |

### Testplan

1. Deploya uppdaterad edge function
2. Testa `test-image-access` action för att verifiera poses.csv-hämtning
3. Starta ny AI-skanning på befintlig byggnad
4. Verifiera att bilder laddas ner och analyseras
5. Kontrollera att detektioner sparas med korrekta 3D-koordinater

---

## Sammanfattning

| Problem | Lösning |
|---------|---------|
| Felaktigt API-endpoint för bilder | Läs `poses.csv` istället |
| Okända bildfilnamn | Parsa CSV för filnamn och position |
| Felaktigt URL-mönster | Använd `/data/{siteId}/datasets_web/{name}/pano/` |

Implementationen följer NavVis officiella datastruktur och bör fungera för alla IVION-instanser.
