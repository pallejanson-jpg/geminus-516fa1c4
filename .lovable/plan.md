
# Analys: Tre frågor om AI-skanningen

## Fråga 1: Varför kör skanningen på Småviken?

**Svar: Den gör det inte.**

Databasen bekräftar att alla skanningar har körts på **Centralstationen** (`building_fm_guid: 755950d9-f235-4d64-a38d-b7fc15a0cad9`, `ivion_site_id: 3045176558137335`). Småviken (`a8fe5835-...`) har **ingen** `ivion_site_id` konfigurerad i `building_settings` och dyker därmed inte ens upp i byggnadslistan i skanningspanelen.

Den aktuella URL:en i webbläsaren bekräftar också att 360°-viewern visar `site=3045176558137335` = Centralstationen.

Förvirringen om "Småviken" kom troligen från Senslinc-dashboarden, inte AI-skanningen. Det var olika diskussioner som blandades ihop.

**Byggnader med Ivion konfigurerat:**
- Akerselva Atrium → site `3373717251911143`
- Centralstationen → site `3045176558137335`
- Småviken → inget ivion_site_id (kan inte scannas)

---

## Fråga 2: Kör vi screenshots istället för riktiga 360°-bilder?

**Svar: Ja, och det är ett fundamentalt arkitekturproblem.**

### Hur systemet fungerar idag

```text
Ivion SDK laddas i webbläsaren
     ↓
SDK navigerar till bild-ID via moveToImageId()
     ↓
Panorama renderas i WebGL-canvas (~800ms)
     ↓
getScreenshot() kör toDataURL() på canvasen
     ↓
JPEG-screenshot (~288×398 px) skickas till Gemini
```

Problemet: Vi tar en **skärmdump av det renderade panoramat** i webbläsarens canvas. Det är inte ett riktigt 360°-foto — det är ett litet utsnitt av det som råkar renderas i det lilla fönstret vid det ögonblicket.

**Varför kan inte riktiga bilder laddas ned?**

Vi har testat direkt nedladdning av Ivion-bildfiler (JPEG, equirectangular 360°) men det misslyckas med 403 Forbidden. NavVis's API kräver att bilderna streamas genom SDK:n med OAuth-tokens som är bundna till webbläsarens session. Filerna kan inte laddas ned server-side med credentials.

**Konsekvenser för mobilanvändning:**

Ja, det är ett problem. `BrowserScanRunner` kräver:
- En öppen webbläsarflik (inte bakgrundsprocess)
- En fungerande Ivion SDK-session (kräver full desktop-miljö för bästa rendering)
- Att användaren väntar medan 200 bilder analyseras

På en mobil är canvasen liten → screenshots är 200–300px → Gemini ser suddig bild → sämre detektering. Dessutom tar det 20+ minuter med fliken öppen.

---

## Fråga 3: Kan vi ladda ned och köra offline som konkurrenter?

**Svar: Tekniskt möjligt via E57, men kräver ny arkitektur och är inte rekommenderat.**

### Marknadsöversikt: Hur konkurrenter gör

| Lösning | Metod |
|---------|-------|
| **Matterport** | Proprietary 3D-skanner → equirectangular JPEG offline batch |
| **Leica Cyclone FIELD 360** | E57-export → lokal batch-analys offline |
| **viAct** | Video-feeds från säkerhetskameror, inte 360° |
| **Mappedin** | Egna sensorer + proprietär pipeline |

**Nyckelskillnad**: Alla dessa äger sitt bildformat och sin pipeline. NavVis/Ivion låser bilderna bakom autentisering — det är en affärsmässig begränsning, inte en teknisk.

### E57-formatet — möjligheter och begränsningar

E57 är ett öppet format som innehåller:
- Punktmoln (3D-koordinater)
- Equirectangular 360°-bilder (riktiga, full-res JPEG)
- Metadata (kameraposition, orientering)

**Fördelar:**
- Riktiga fullupplösta bilder (6000×3000 px vanligt)
- Inga session-cookies eller OAuth-krav
- Kan processas offline, server-side
- Batch-analys utan navigeringstid → mycket snabbare

**Nackdelar:**
- En E57-fil för ett våningsplan = 5–30 GB
- NavVis exporterar E57 men inte via API — måste göras manuellt från NavVis-portalen
- Uppladdning till servern tar 30–60 minuter per våning
- Browser-side parsing av E57 är omöjligt (binärformat, inga JS-bibliotek)
- Kräver en backend-process (edge function klarar inte 30 GB-filer)

### Rekommenderad väg framåt

**Kortsiktig fix (implementeras nu):**
Förbättra screenshot-kvaliteten för att få maximal effekt ur nuvarande approach:
1. Öka container-storleken i `BrowserScanRunner` till `height: 70vh` så screenshots blir 600–800px höga
2. Lägg till few-shot example-images i batch-prompten (de tränar Gemini att känna igen rätt objekt)
3. Förbättra prompt-texten för per-bild analys

**Medellångsiktig (1–2 månader):**
Utforska om NavVis har ett "download-all-images"-API som vi inte använder än. NavVis har en Enterprise API som ibland tillåter direktnedladdning med service account-credentials (inte OAuth). Värt att testa.

**Långsiktig (om E57 önskas):**
Skapa ett separat "offline batch"-flöde:
1. Användaren laddar upp E57-fil via en fil-uppladdnings-sida
2. Server-side processing extraherar bilder (kräver en persistent bakgrundsprocess, inte en edge function)
3. Gemini Vision analyserar bilderna i batch
4. Resultaten importeras till Geminus

Detta är möjligt men kräver en annan arkitektur (t.ex. en separat worker-server).

---

## Plan: Genomför de tre konkreta fixarna för bättre detektering

Dessa kan implementeras omedelbart och förbättrar detektionsförmågan avsevärt utan att byta arkitektur.

### Fix 1: Öka container-storleken

`BrowserScanRunner.tsx` rad 647–651:
```tsx
// Nuvarande:
style={{ display: 'block', width: '100%', minHeight: '400px', height: '50vh' }}

// Ny: Ge viewern maximalt utrymme
style={{ display: 'block', width: '100%', height: '70vh', minHeight: '500px' }}
```

En större container → Ivion renderar i högre upplösning → screenshots är 600–900px → Gemini ser mer detaljer.

### Fix 2: Lägg till few-shot examples i batch-prompten

I `ai-asset-detection/index.ts`, i `analyze-screenshot-batch`-casen, lägg till template-examples precis som `analyzeImageWithAI` gör:

```typescript
// Sätt in FÖRE screenshot-bilderna:
for (const tpl of tpls) {
  if (tpl.example_images && tpl.example_images.length > 0) {
    userContent.push({
      type: 'text',
      text: `Reference examples for "${tpl.object_type}" (${tpl.name}):`
    });
    for (const exUrl of tpl.example_images.slice(0, 3)) {
      userContent.push({ type: 'image_url', image_url: { url: exUrl } });
    }
  }
}
```

Few-shot examples hjälper Gemini att förstå exakt vilket utseende brandsläckare, dörrar, larmknappar etc. har i svenska byggnader.

### Fix 3: Förbättra prompt-strukturen

Ändra prompten så Gemini explicit analyserar varje bild separat:

```typescript
text: `You are an expert at detecting fire safety equipment and building assets in indoor 360° panorama photographs.

You will receive ${params.screenshots.length} viewport captures from the SAME position in a building, taken at different rotations (every ${Math.round(360 / params.screenshots.length)}°).

ANALYZE EACH IMAGE INDIVIDUALLY and report ALL objects you find.

Look for these specific objects:
${objectDescriptions}

IMPORTANT RULES:
- Report each detected object separately with its image_index (0, 1, or 2)
- Include detections even with confidence 0.3 or above  
- Be generous with detections — it is better to report too many than to miss objects
- Focus on object type, not background

Return a JSON array. If nothing found return [].`
```

### Tekniska filändringar

| Fil | Ändring |
|-----|---------|
| `src/components/ai-scan/BrowserScanRunner.tsx` | Container `height: '70vh'` |
| `supabase/functions/ai-asset-detection/index.ts` | Few-shot examples + ny prompt i `analyze-screenshot-batch` |

### Sammanfattning om offline/mobil

Det är inte möjligt att köra AI-skanningen på mobil med nuvarande approach eftersom:
1. Ivion SDK kräver full webbläsarmiljö för rendering
2. Screenshots är för små på mobil

En riktig mobilapp för inventering skulle behöva en annan approach — t.ex. att användaren fotograferar objekt med kameran och AI:n identifierar dem direkt (liknande en QR-skanner). Det är en separat feature som kan läggas till sidan av Ivion-skanningen.
