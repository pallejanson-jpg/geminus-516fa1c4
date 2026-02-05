

# Plan: Åtgärda AI-skanning - Bildnedladdning misslyckas

## Problemanalys

Efter undersökning av edge function-loggar och databas har jag identifierat rotorsaken:

| Steg | Status | Problem |
|------|--------|---------|
| Ivion-autentisering | ✅ Fungerar | `SWG_PalJ` bekräftat, 224 sites |
| Hämta datasets | ✅ Fungerar | Dataset `2020-12-14_13.58.34` hittas |
| Hämta poses.csv | ❌ 404/blockerad | Filen finns inte eller är ej tillgänglig |
| Proba bildfilnamn | ❌ 404 på alla | `00000-pano.jpg` etc. existerar inte |
| Ladda ner bild | ❌ Aldrig når hit | Alla URL:er returnerar 404 |

**Rotorsak**: NavVis-instansen använder ett **annat filnamnsformat** än det förväntade `XXXXX-pano.jpg`. Koden söker efter fel filnamn.

## Lösning: Tre-stegs strategi

### Steg 1: Använd NavVis Storage API för att lista filer

Istället för att gissa filnamn, använd NavVis API för att lista faktiska filer i dataset:

```typescript
// Ny endpoint för att lista filer i ett dataset
async function listDatasetFiles(siteId: string, datasetName: string): Promise<string[]> {
  const token = await getIvionToken();
  
  // NavVis API endpoint för att lista filer
  const endpoints = [
    `${IVION_API_URL}/api/site/${siteId}/storage/list/datasets_web/${datasetName}/pano`,
    `${IVION_API_URL}/api/site/${siteId}/datasets/${datasetName}/images`,
    `${IVION_API_URL}/api/dataset/${datasetName}/images`,
  ];
  
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      headers: { 'x-authorization': `Bearer ${token}` },
    });
    if (response.ok) {
      const data = await response.json();
      // Extrahera filnamn från response
      return extractFilenames(data);
    }
  }
  
  return [];
}
```

### Steg 2: Utöka filnamnsmönster att proba

NavVis använder olika format beroende på skanner:

```typescript
// Nya filnamnsmönster att testa
const patterns = [
  `${index.toString().padStart(5, '0')}-pano.jpg`,     // 00000-pano.jpg
  `${index.toString().padStart(5, '0')}.jpg`,          // 00000.jpg
  `pano_${index.toString().padStart(5, '0')}.jpg`,     // pano_00000.jpg
  `panorama_${index}.jpg`,                              // panorama_0.jpg
  `img_${index.toString().padStart(6, '0')}.jpg`,      // img_000000.jpg
];
```

### Steg 3: Testa alternativa katalogstrukturer

```typescript
const directories = [
  `datasets_web/${datasetName}/pano`,      // Standard
  `datasets_web/${datasetName}/panorama`,  // Alternativ
  `datasets_web/${datasetName}/images`,    // Alternativ
  `datasets/${datasetName}/pano`,          // Äldre format
];
```

---

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `supabase/functions/ai-asset-detection/index.ts` | Ny `listDatasetFiles()`, utökade filnamnsmönster, förbättrad diagnostik |

---

## Teknisk implementation

### Del 1: Ny funktion för att lista filer

Lägg till i `ai-asset-detection/index.ts`:

```typescript
// Försök lista filer via NavVis Storage API
async function discoverDatasetFiles(
  siteId: string,
  datasetName: string
): Promise<{ filenames: string[]; source: string }> {
  const token = await getIvionToken();
  
  // 1. Försök list-API
  const listUrl = `${IVION_API_URL}/api/site/${siteId}/storage/list/datasets_web/${datasetName}/pano`;
  try {
    const resp = await fetch(listUrl, {
      headers: { 'x-authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });
    if (resp.ok) {
      const data = await resp.json();
      // NavVis returnerar ofta { files: [...] } eller direkt array
      const files = Array.isArray(data) ? data : data.files || data.items || [];
      if (files.length > 0) {
        console.log(`Found ${files.length} files via storage/list API`);
        return { filenames: files.map(f => f.name || f), source: 'list-api' };
      }
    }
  } catch (e) {
    console.log('Storage list API not available');
  }
  
  // 2. Proba olika filnamnsmönster
  const testFilenames = [
    '00000-pano.jpg', '00000.jpg', 'pano_00000.jpg',
    '0-pano.jpg', '0.jpg', 'panorama_0.jpg'
  ];
  
  for (const filename of testFilenames) {
    const testUrl = `${IVION_API_URL}/api/site/${siteId}/storage/redirect/datasets_web/${datasetName}/pano/${filename}`;
    const exists = await verifyImageUrlWithGet(testUrl, token);
    if (exists) {
      console.log(`Found working pattern: ${filename}`);
      return { filenames: [filename], source: filename.includes('-pano') ? 'dash-pano' : 'simple' };
    }
  }
  
  return { filenames: [], source: 'none' };
}
```

### Del 2: Utöka `probeDatasetImages` med fler mönster

```typescript
async function probeDatasetImages(
  siteId: string,
  datasetName: string,
  maxImages: number = 500
): Promise<IvionImage[]> {
  // Först: försök lista filer direkt
  const discovered = await discoverDatasetFiles(siteId, datasetName);
  if (discovered.filenames.length > 0) {
    return discovered.filenames.map((f, i) => ({
      id: i,
      filePath: f,
      name: f,
    }));
  }
  
  // Fallback: proba olika mönster
  const token = await getIvionToken();
  const patterns = [
    (i: number) => `${String(i).padStart(5, '0')}-pano.jpg`,
    (i: number) => `${String(i).padStart(5, '0')}.jpg`,
    (i: number) => `pano_${String(i).padStart(5, '0')}.jpg`,
    (i: number) => `panorama_${i}.jpg`,
    (i: number) => `img_${String(i).padStart(6, '0')}.jpg`,
  ];
  
  // Testa varje mönster med bild 0
  for (const pattern of patterns) {
    const filename = pattern(0);
    const testUrl = `${IVION_API_URL}/api/site/${siteId}/storage/redirect/datasets_web/${datasetName}/pano/${filename}`;
    const exists = await verifyImageUrlWithGet(testUrl, token);
    if (exists) {
      console.log(`Pattern match: ${filename}`);
      // Använd detta mönster för alla bilder
      return await probeWithPattern(siteId, datasetName, pattern, maxImages, token);
    }
  }
  
  return [];
}
```

### Del 3: Förbättra diagnostik i test-image-download

```typescript
// Lägg till info om vilka mönster som testats
case 'test-image-download':
  // Inkludera vilka filnamnsmönster som testats
  const result = await testImageDownload(params.siteId);
  result.testedPatterns = ['00000-pano.jpg', '00000.jpg', 'pano_00000.jpg', ...];
  result.suggestion = 'Kontrollera korrekt filnamnsformat i NavVis admin';
  return result;
```

---

## Alternativ lösning: Manuell konfiguration

Om automatisk upptäckt inte fungerar, kan vi låta användaren ange rätt format:

| Inställning | Beskrivning |
|-------------|-------------|
| `image_filename_pattern` | T.ex. `{index:5}-pano.jpg` eller `panorama_{index}.jpg` |
| `image_directory` | T.ex. `pano` eller `panorama` |

Detta kan sparas per building i `building_settings`:

```sql
ALTER TABLE building_settings 
ADD COLUMN ivion_image_pattern TEXT,
ADD COLUMN ivion_image_directory TEXT DEFAULT 'pano';
```

---

## Nästa steg

1. Implementera utökad filupptäckt med fler mönster
2. Lägga till Storage List API-anrop
3. Förbättra felmeddelanden med specifik diagnostik
4. Eventuellt: UI för manuell konfiguration av filnamnsmönster

---

## Sammanfattning

| Problem | Orsak | Lösning |
|---------|-------|---------|
| Inga bilder hittas | Fel filnamnsformat (`00000-pano.jpg`) | Testa fler mönster, använd List API |
| poses.csv saknas | Ej tillgänglig på denna NavVis-instans | Fallback till direkt fil-upptäckt |
| Alla URL:er ger 404 | Filerna finns på annan sökväg/format | Utöka sökstrategin |

