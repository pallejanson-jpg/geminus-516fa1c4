

# Plan: Optimera AI-skanning med exempelbilder

## Sammanfattning av dina frågor

### 1. Varför tar skanningen lång tid?
Processen per bild tar ~20-30 sekunder:
- Nedladdning av panorama (2-10 MB): ~3-5 sek
- AI-analys med Gemini: ~5-10 sek  
- Spara thumbnail: ~1 sek
- Databas + nätverksoverhead: ~2 sek

**Med 100 bilder = ~30-50 minuter** (om allt körs automatiskt)

### 2. Kostnad i credits
Lovable AI (Gemini 2.5 Flash) prissättning:
- Input: ~$0.075 / miljon tokens
- Stora panoramabilder = ~$0.02-0.05 per bild
- **100 bilder ≈ $2-5 i AI-kostnader**

### 3. Skulle exempelbilder hjälpa?
**Ja, definitivt!** "Few-shot learning" där vi visar AI:n exempelbilder förbättrar:
- ✅ **Precision** - Färre felaktiga detektioner
- ✅ **Hastighet** - AI:n vet exakt vad den letar efter
- ✅ **Konsistens** - Samma typ identifieras likt varje gång

---

## Lösning: Exempelbilder i mallarna

### Databasändring

Lägg till stöd för exempelbilder i `detection_templates`:

```sql
ALTER TABLE detection_templates 
ADD COLUMN example_images TEXT[] DEFAULT '{}';
-- Array med URLs till exempelbilder
```

### Uppdaterad mallhantering

Lägg till bilduppladdning i mallformuläret:

```text
┌─────────────────────────────────────────────────────────┐
│ Brandsläckare                                           │
├─────────────────────────────────────────────────────────┤
│ AI-prompt:                                              │
│ [Look for red fire extinguishers...]                    │
├─────────────────────────────────────────────────────────┤
│ Exempelbilder: (rekommenderas 2-4 bilder)               │
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌───────┐                       │
│ │ 📷  │ │ 📷  │ │ 📷  │ │ + Lägg│                       │
│ │     │ │     │ │     │ │  till │                       │
│ └──🗑─┘ └──🗑─┘ └──🗑─┘ └───────┘                       │
└─────────────────────────────────────────────────────────┘
```

### Uppdaterad AI-prompt med few-shot

Istället för:
```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "Detect fire_extinguisher: Look for red..." },
    { "type": "image_url", "image_url": { "url": "panorama.jpg" } }
  ]
}
```

Med exempelbilder (few-shot):
```json
{
  "role": "user", 
  "content": [
    { "type": "text", "text": "Here are examples of fire_extinguisher:" },
    { "type": "image_url", "image_url": { "url": "example1.jpg" } },
    { "type": "image_url", "image_url": { "url": "example2.jpg" } },
    { "type": "text", "text": "Now detect fire_extinguisher in this panorama:" },
    { "type": "image_url", "image_url": { "url": "panorama.jpg" } }
  ]
}
```

---

## Teknisk sammanfattning

### Filer som ändras

| Fil | Åtgärd | Beskrivning |
|-----|--------|-------------|
| Databas | Migration | Lägg till `example_images TEXT[]` kolumn |
| `src/components/ai-scan/TemplateManagement.tsx` | Ändra | Lägg till bilduppladdning för exempelbilder |
| `supabase/functions/ai-asset-detection/index.ts` | Ändra | Inkludera exempelbilder i AI-prompten |

### Ny datastruktur

```typescript
interface DetectionTemplate {
  id: string;
  name: string;
  object_type: string;
  ai_prompt: string;
  example_images: string[];  // ← NYTT: URLs till exempelbilder
  // ...
}
```

### Bilduppladdning

Exempelbilder laddas upp till:
```
Supabase Storage: template-examples/{template_id}/{filename}
```

### Förbättrad AI-analys

```typescript
async function analyzeImageWithAI(
  imageBase64: string,
  templates: DetectionTemplate[]
): Promise<Detection[]> {
  
  // Bygg content array med exempelbilder först
  const content: any[] = [];
  
  for (const template of templates) {
    if (template.example_images?.length > 0) {
      content.push({ 
        type: "text", 
        text: `Examples of ${template.object_type}:` 
      });
      
      for (const exampleUrl of template.example_images) {
        content.push({ 
          type: "image_url", 
          image_url: { url: exampleUrl } 
        });
      }
    }
    
    content.push({ 
      type: "text", 
      text: `${template.object_type}: ${template.ai_prompt}` 
    });
  }
  
  // Sist: panoramabilden att analysera
  content.push({ 
    type: "text", 
    text: "Now analyze this 360° panorama and find these objects:" 
  });
  content.push({ 
    type: "image_url", 
    image_url: { url: `data:image/jpeg;base64,${imageBase64}` } 
  });
  
  // Anropa AI
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    // ...
  });
}
```

---

## Bonus: Prestandaoptimering

### Parallell bildnedladdning
Istället för sekventiell nedladdning, ladda ner nästa bild medan AI analyserar:

```typescript
// Nuvarande: sekventiellt
for (image of images) {
  const base64 = await download(image);
  const result = await analyze(base64);
}

// Optimerat: pipeline
let nextImagePromise = download(images[0]);
for (let i = 0; i < images.length; i++) {
  const base64 = await nextImagePromise;
  if (i + 1 < images.length) {
    nextImagePromise = download(images[i + 1]); // Starta nästa
  }
  const result = await analyze(base64);
}
```

**Uppskattad tidsbesparing:** ~30-40%

---

## Rekommenderade exempelbilder per mall

| Mall | Antal exempel | Rekommendation |
|------|---------------|----------------|
| Brandsläckare | 3-4 | Olika storlekar, vägg + golv |
| Nödutgång | 2-3 | Olika ljusförhållanden |
| Larmknapp | 2-3 | Med/utan glas, olika märken |
| Brandslang | 2-3 | Skåp + rulle |
| Elskåp | 2-3 | Olika storlekar |

---

## Testplan

1. **Lägg till exempelbilder**
   - Gå till Mallar-fliken
   - Redigera "Brandsläckare"
   - Ladda upp 3 exempelbilder
   - Spara

2. **Kör skanning**
   - Starta en ny skanning med mallen
   - Jämför precision mot tidigare körningar

3. **Mät förbättring**
   - Confidence-nivåer bör vara högre
   - Färre "falska positiva" (felaktiga detektioner)

