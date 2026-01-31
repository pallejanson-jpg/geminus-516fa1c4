
# Plan: Förbättra AI-skanningssidan med navigation och avbryt-funktion

## Översikt

Denna plan åtgärdar de identifierade UX-problemen på AI-skanningssidan och lägger grunden för framtida AI-träning.

## Problem att lösa

1. **Ingen tillbaka-knapp** – användare kan inte lämna sidan
2. **Ingen avbryt-funktion** – pågående skanningar kan inte stoppas
3. **Ingen möjlighet att förbättra AI:n** – inga verktyg för att justera promptar eller lägga till mallar

---

## Del 1: Lägg till tillbaka-knapp i header

### Fil: `src/pages/AiAssetScan.tsx`

Lägg till en tydlig tillbaka-knapp i headern som navigerar användaren tillbaka till inventering.

**Ändringar:**
- Importera `ArrowLeft` och `useNavigate`
- Lägg till en tillbaka-knapp längst till vänster i headern
- Knappen navigerar till föregående sida eller `/inventory` som fallback

```text
Header-layout efter ändring:
┌─────────────────────────────────────────────────────────────┐
│ [←] [AI-ikon] AI-assisterad inventering          [Uppdatera]│
└─────────────────────────────────────────────────────────────┘
```

---

## Del 2: Lägg till avbryt-funktion för pågående skanning

### Fil: `src/components/ai-scan/ScanProgressPanel.tsx`

Lägg till en "Avbryt skanning"-knapp som sätter jobbstatus till "cancelled".

### Fil: `supabase/functions/ai-asset-detection/index.ts`

Lägg till en ny action `cancel-scan` som uppdaterar jobbstatus.

**Ändringar i ScanProgressPanel:**
- Ny `cancelScan()` funktion
- Ny knapp "Avbryt" bredvid "Bearbeta nästa batch"
- Visuell bekräftelse via toast

---

## Del 3: Skapa gränssnitt för mallhantering (framtida AI-träning)

### Ny fil: `src/components/ai-scan/TemplateManagement.tsx`

Ett nytt gränssnitt för att hantera och förbättra detektionsmallar:

**Funktioner:**
- Lista alla mallar med namn, beskrivning och AI-prompt
- Redigera AI-promptar direkt i gränssnittet
- Lägg till nya mallar för nya objekttyper
- Förhandsgranska/testa en mall mot en uppladdad bild

**Layout:**
```text
┌──────────────────────────────────────────────────┐
│ Detektionsmallar                      [+ Ny mall]│
├──────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────┐   │
│ │ 🧯 Brandsläckare                   [Redigera]  │
│ │ "Look for red fire extinguisher..."        │   │
│ │ Kategori: fire_extinguisher               │   │
│ └────────────────────────────────────────────┘   │
│ ┌────────────────────────────────────────────┐   │
│ │ 🚪 Nödutgångsskylt               [Redigera]   │
│ │ "Look for green emergency exit signs..."   │   │
│ │ Kategori: emergency_exit                  │   │
│ └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

### Fil: `src/pages/AiAssetScan.tsx`

Lägg till en fjärde tab "Mallar" för mallhantering.

---

## Teknisk sammanfattning

### Filer som ändras

| Fil | Åtgärd | Beskrivning |
|-----|--------|-------------|
| `src/pages/AiAssetScan.tsx` | Ändra | Lägg till tillbaka-knapp och Mallar-tab |
| `src/components/ai-scan/ScanProgressPanel.tsx` | Ändra | Lägg till avbryt-funktion |
| `src/components/ai-scan/TemplateManagement.tsx` | **Ny fil** | Gränssnitt för mallhantering |
| `supabase/functions/ai-asset-detection/index.ts` | Ändra | Lägg till `cancel-scan` och `update-template` actions |

### Edge function-ändringar

**Ny action: `cancel-scan`**
```typescript
if (action === 'cancel-scan') {
  const { scanJobId } = body;
  await supabase.from('scan_jobs')
    .update({ status: 'cancelled' })
    .eq('id', scanJobId);
  return new Response(JSON.stringify({ success: true }));
}
```

**Ny action: `update-template`**
```typescript
if (action === 'update-template') {
  const { templateId, ai_prompt, name, description } = body;
  await supabase.from('detection_templates')
    .update({ ai_prompt, name, description, updated_at: new Date().toISOString() })
    .eq('id', templateId);
  return new Response(JSON.stringify({ success: true }));
}
```

---

## Framtida: Few-shot learning med referensbilder

En framtida förbättring skulle vara att låta användare ladda upp referensbilder för varje mall. Dessa bilder inkluderas sedan i AI-prompten som visuella exempel.

**Databasändring (framtid):**
```sql
CREATE TABLE template_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES detection_templates(id),
  image_url TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**AI-prompt med exempel (framtid):**
```typescript
{
  role: "user",
  content: [
    { type: "text", text: "Here is an example of what to look for:" },
    { type: "image_url", image_url: { url: exampleImageUrl } },
    { type: "text", text: "Now detect similar objects in this panorama:" },
    { type: "image_url", image_url: { url: panoramaImageUrl } }
  ]
}
```

---

## Testplan

1. **Tillbaka-knapp**
   - Navigera till `/inventory/ai-scan`
   - Klicka på tillbaka-knappen
   - Verifiera att du återvänder till inventering

2. **Avbryt skanning**
   - Starta en skanning
   - Klicka på "Avbryt"
   - Verifiera att status ändras till "Avbruten"

3. **Mallhantering**
   - Öppna Mallar-tabben
   - Redigera en AI-prompt
   - Spara och verifiera att ändringen bevaras

---

## Sammanfattning

| Problem | Lösning |
|---------|---------|
| Kan inte lämna sidan | Tillbaka-knapp i header |
| Kan inte avbryta skanning | Avbryt-knapp + ny backend-action |
| Kan inte förbättra AI | Mallhanteringsgränssnitt för AI-promptar |
| Framtida AI-träning | Few-shot learning med referensbilder (planerat) |
