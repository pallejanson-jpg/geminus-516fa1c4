
# Plan: Utökad AI-analys med fabrikat, modell och storlek

## Översikt

Denna plan utökar AI-bildanalysen för att automatiskt identifiera och extrahera detaljerade egenskaper från detekterade objekt, såsom fabrikat, modell, storlek, typ och teknisk information. Dessa egenskaper sparas i pending_detections och överförs automatiskt till assets vid godkännande.

## Nuvarande flöde

```text
Panoramabild → AI (Gemini) → Detection
                              ├── object_type: "fire_extinguisher"
                              ├── confidence: 0.92
                              ├── bounding_box: [y1, x1, y2, x2]
                              └── description: "Red fire extinguisher on wall"

Detection → Approve → Asset
                      ├── name: "Brandsläckare"
                      ├── category: "Instance"
                      ├── coordinates: x, y, z
                      └── attributes: { ai_description: "..." }
```

## Nytt flöde med utökad analys

```text
Panoramabild → AI (Gemini) → Detection
                              ├── object_type: "fire_extinguisher"
                              ├── confidence: 0.92
                              ├── bounding_box: [y1, x1, y2, x2]
                              ├── description: "Red 6kg ABC fire extinguisher..."
                              └── extracted_properties:      ← NY
                                  ├── brand: "Gloria"
                                  ├── model: "PD6GA"
                                  ├── size: "6 kg"
                                  ├── type: "Pulver ABC"
                                  ├── color: "Röd"
                                  ├── mounting: "Väggmonterad"
                                  └── condition: "God"

Detection → Approve → Asset
                      ├── name: "Gloria PD6GA"       ← Automatiskt format
                      ├── common_name: "Pulversläckare 6kg"
                      └── attributes: {
                            ai_description: "...",
                            brand: "Gloria",
                            model: "PD6GA",
                            size: "6 kg",
                            type: "Pulver ABC",
                            ...
                          }
```

---

## Del 1: Databasuppdatering

### Ny kolumn i pending_detections

Lägg till en JSONB-kolumn för att lagra de extraherade egenskaperna:

```sql
ALTER TABLE pending_detections 
ADD COLUMN extracted_properties JSONB DEFAULT '{}';
```

---

## Del 2: Uppdatera AI-prompten

### Fil: `supabase/functions/ai-asset-detection/index.ts`

Uppdatera `analyzeImageWithAI()` för att be Gemini extrahera detaljerade egenskaper:

**Nuvarande prompt (förenklad):**
```typescript
"Detect these objects... Return JSON with object_type, confidence, bounding_box, description"
```

**Ny prompt (utökad):**
```typescript
"Detect safety equipment and extract detailed properties.

For each object, return:
- object_type: the type code
- confidence: 0.0 to 1.0
- bounding_box: [ymin, xmin, ymax, xmax] normalized 0-1000
- description: what you observe
- extracted_properties: {
    brand: manufacturer name if visible (e.g., 'Gloria', 'Ansul', 'Presto')
    model: model number/name if visible
    size: capacity/size (e.g., '6 kg', '2 kg', 'A3')
    type: specific type (e.g., 'Pulver ABC', 'CO2', 'Skum')
    color: primary color
    mounting: how it's mounted ('Väggmonterad', 'Golvstående', 'I skåp')
    condition: visible condition ('God', 'Sliten', 'Okänd')
    text_visible: any readable text on the object
  }

Read and OCR any visible text, labels, or stickers to extract brand/model.
If a property cannot be determined, omit it from the object."
```

### Uppdaterad typning

```typescript
interface Detection {
  object_type: string;
  confidence: number;
  bounding_box: [number, number, number, number];
  description: string;
  extracted_properties?: {
    brand?: string;
    model?: string;
    size?: string;
    type?: string;
    color?: string;
    mounting?: string;
    condition?: string;
    text_visible?: string;
  };
}
```

---

## Del 3: Spara extraherade egenskaper

### I `processBatch()` - spara till pending_detections

```typescript
const { error: insertError } = await supabase.from('pending_detections').insert({
  // ... befintliga fält ...
  ai_description: det.description,
  extracted_properties: det.extracted_properties || {},  // ← NY
});
```

---

## Del 4: Visa egenskaper i granskning

### Fil: `src/components/ai-scan/DetectionReviewQueue.tsx`

Visa de extraherade egenskaperna i detektionskortet och detaljdialogen:

**I kortvy:**
```typescript
{detection.extracted_properties?.brand && (
  <Badge variant="outline" className="text-xs">
    {detection.extracted_properties.brand}
  </Badge>
)}
```

**I detaljdialog:**
```typescript
<div className="grid grid-cols-2 gap-2 text-sm">
  {detection.extracted_properties?.brand && (
    <div>
      <span className="text-muted-foreground">Fabrikat:</span>
      <span className="ml-2 font-medium">{detection.extracted_properties.brand}</span>
    </div>
  )}
  {detection.extracted_properties?.model && (
    <div>
      <span className="text-muted-foreground">Modell:</span>
      <span className="ml-2 font-medium">{detection.extracted_properties.model}</span>
    </div>
  )}
  {/* ... fler egenskaper ... */}
</div>
```

---

## Del 5: Överför egenskaper vid godkännande

### I `approveDetection()` - skapa smartare asset

```typescript
// Bygg namn från extraherade egenskaper
const props = detection.extracted_properties || {};
const baseName = detection.detection_templates?.name || detection.object_type;

// Generera beskrivande namn: "Gloria PD6GA 6kg" eller fallback
const assetName = [props.brand, props.model, props.size]
  .filter(Boolean)
  .join(' ') || baseName;

// Generera common_name: "Pulversläckare 6kg ABC"
const commonName = [props.type, props.size]
  .filter(Boolean)
  .join(' ') || baseName;

// Skapa asset med alla egenskaper i attributes
const { error: assetError } = await supabase.from('assets').insert({
  fm_guid: assetFmGuid,
  name: assetName,                    // ← Smartare namn
  common_name: commonName,            // ← Beskrivande namn
  category: 'Instance',
  asset_type: detection.detection_templates?.default_category || detection.object_type,
  // ... koordinater ...
  attributes: {
    ai_detected: true,
    ai_confidence: detection.confidence,
    ai_description: detection.ai_description,
    // Extraherade egenskaper direkt i attributes
    brand: props.brand || null,
    model: props.model || null,
    size: props.size || null,
    type: props.type || null,
    color: props.color || null,
    mounting: props.mounting || null,
    condition: props.condition || null,
    text_visible: props.text_visible || null,
  },
});
```

---

## Del 6: Uppdatera TypeScript-typer

### Interface för pending_detections

```typescript
interface PendingDetection {
  id: string;
  object_type: string;
  confidence: number;
  bounding_box: any;
  thumbnail_url: string | null;
  ai_description: string | null;
  extracted_properties: {           // ← NY
    brand?: string;
    model?: string;
    size?: string;
    type?: string;
    color?: string;
    mounting?: string;
    condition?: string;
    text_visible?: string;
  } | null;
  status: string;
  // ...
}
```

---

## Teknisk sammanfattning

### Filer som ändras

| Fil | Åtgärd | Beskrivning |
|-----|--------|-------------|
| Databas | Migration | Lägg till `extracted_properties` JSONB-kolumn |
| `supabase/functions/ai-asset-detection/index.ts` | Ändra | Utökad AI-prompt + spara/överföra egenskaper |
| `src/components/ai-scan/DetectionReviewQueue.tsx` | Ändra | Visa fabrikat/modell i kort och dialog |

### Exempeldata efter implementering

```json
{
  "object_type": "fire_extinguisher",
  "confidence": 0.94,
  "description": "Red powder fire extinguisher mounted on wall",
  "extracted_properties": {
    "brand": "Gloria",
    "model": "PD6GA",
    "size": "6 kg",
    "type": "Pulver ABC",
    "color": "Röd",
    "mounting": "Väggmonterad",
    "condition": "God",
    "text_visible": "GLORIA PD6GA PULVER ABC 6KG"
  }
}
```

### Asset efter godkännande

```json
{
  "fm_guid": "uuid...",
  "name": "Gloria PD6GA 6kg",
  "common_name": "Pulver ABC 6kg",
  "category": "Instance",
  "asset_type": "fire_extinguisher",
  "attributes": {
    "ai_detected": true,
    "ai_confidence": 0.94,
    "brand": "Gloria",
    "model": "PD6GA",
    "size": "6 kg",
    "type": "Pulver ABC"
  }
}
```

---

## Framtida förbättringar

| Förbättring | Beskrivning |
|-------------|-------------|
| **Redigera före godkännande** | Låt användaren justera fabrikat/modell i granskningen innan godkännande |
| **Automatisk klassificering** | Matcha fabrikat mot produktdatabas för att få certifieringar, nästa serviceintervall etc. |
| **Validering** | Varna om AI:n inte kunde läsa texten eller är osäker på modell |

---

## Testplan

1. Starta en ny skanning på en byggnad
2. Verifiera att nya detektioner har `extracted_properties` med fabrikat/modell
3. Öppna detaljdialogen och se att egenskaperna visas
4. Godkänn en detektion och verifiera att asset skapas med rätt namn och attributes
