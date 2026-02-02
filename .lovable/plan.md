
# Plan: Implementera Congeria Dokumentsynkronisering

## Problemanalys

Den nuvarande `congeria-sync` Edge Function är endast en placeholder. För att synka dokument från Congeria behöver vi:

1. **Logga in** på Congeria (session-baserad auth)
2. **Navigera** till dokumentmappen för byggnaden
3. **Parsa HTML** för att extrahera dokumentlista med metadata
4. **Ladda ner** varje dokument
5. **Ladda upp** till Supabase Storage
6. **Spara metadata** i `documents`-tabellen

## Lösningsalternativ

### Alternativ A: Firecrawl Connector (Rekommenderat)
Firecrawl finns tillgängligt som connector och hanterar web scraping professionellt:
- Hanterar JavaScript-rendering
- Extraherar strukturerad data
- Bypassa anti-bot-åtgärder

**Nackdel:** Kräver att du aktiverar Firecrawl-connector

### Alternativ B: Direkt Web Scraping i Edge Function
Implementera session-baserad login och HTML-parsing direkt:
- Mer kontroll över processen
- Ingen extern beroende

**Nackdel:** Congeria kan ha JavaScript-renderade sidor som kräver browser

### Alternativ C: Manuell uppladdning (Fallback)
Lägg till UI för manuell dokumentuppladdning:
- Fungerar alltid
- Ingen komplexitet med scraping

**Nackdel:** Kräver manuellt arbete

---

## Vald Strategi: Kombination A + C

1. **Primärt:** Använd Firecrawl för att scrapa dokumentlistor
2. **Backup:** Lägg till manuell uppladdning som fallback

---

## Implementation

### Steg 1: Aktivera Firecrawl Connector
Du behöver koppla Firecrawl till projektet via Settings → Connectors.

### Steg 2: Uppdatera Edge Function

**Fil: `supabase/functions/congeria-sync/index.ts`**

```typescript
// Flöde:
// 1. Använd Firecrawl för att scrapa Congeria-sidan
// 2. Extrahera dokumentlänkar och metadata från HTML
// 3. Ladda ner varje dokument
// 4. Ladda upp till Supabase Storage
// 5. Spara i documents-tabellen

async function syncDocuments(buildingFmGuid: string, folderUrl: string) {
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  
  // Scrapa Congeria-sidan med Firecrawl
  const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: folderUrl,
      formats: ['html', 'links'],
      waitFor: 3000, // Vänta på JS-rendering
    }),
  });
  
  const scraped = await scrapeResponse.json();
  
  // Parsa dokumentlänkar från HTML
  const documents = parseDocumentLinks(scraped.data.html, scraped.data.links);
  
  // Ladda ner och ladda upp varje dokument
  for (const doc of documents) {
    const fileData = await downloadDocument(doc.url);
    const storagePath = `${buildingFmGuid}/${doc.name}`;
    
    await supabase.storage.from('documents').upload(storagePath, fileData);
    
    await supabase.from('documents').upsert({
      building_fm_guid: buildingFmGuid,
      file_name: doc.name,
      file_path: storagePath,
      file_size: doc.size,
      mime_type: doc.mimeType,
      source_system: 'congeria',
      source_url: doc.url,
      metadata: doc.metadata,
    });
  }
}
```

### Steg 3: Lägg till Manuell Uppladdning i DocumentsView

**Fil: `src/components/portfolio/DocumentsView.tsx`**

Lägg till en "Ladda upp dokument"-knapp som fallback:
- Dropzone för filuppladdning
- Sparar direkt till Supabase Storage och documents-tabellen
- Fungerar även utan Congeria-koppling

---

## Filändringar

| Fil | Åtgärd |
|-----|--------|
| `supabase/functions/congeria-sync/index.ts` | **ÄNDRA** - Implementera riktig sync-logik |
| `src/components/portfolio/DocumentsView.tsx` | **ÄNDRA** - Lägg till manuell uppladdning |

---

## Förväntade krav

1. **Firecrawl API Key** - Du behöver aktivera Firecrawl-connector
2. **Congeria credentials** - Redan konfigurerade ✓

---

## Nästa steg efter implementation

1. Testa sync genom att klicka "Synka" i Settings → Sync → Congeria
2. Verifiera att dokument dyker upp i DocumentsView för Småviken
3. Testa manuell uppladdning som backup

---

## Teknisk not: Congeria URL-struktur

Nuvarande URL: `https://fms.congeria.com/#/Demo/Arkiv/3272%20-%20Småviken/DoU/PDF`

Denna URL använder hash-routing (`#/`), vilket innebär att innehållet renderas via JavaScript. Firecrawl med `waitFor`-parameter hanterar detta genom att vänta på rendering.

Vill du att jag aktiverar Firecrawl-connector och implementerar denna lösning?
