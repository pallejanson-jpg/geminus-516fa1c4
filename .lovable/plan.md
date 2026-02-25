

## XKT-uppdelning per våningsplan med xeokit-convert

### Nuläge

`splitAndStoreByStorey` i `acc-xkt-converter.ts` är en **placeholder** -- den sparar bara metadata-rader i `xkt_models`-tabellen men skapar inga faktiska per-vånings-XKT-filer. Kommentaren i koden säger: *"True binary splitting requires parsing XKT internals which is complex."*

### Kan vi göra det med xeokit-convert?

**Ja, det går.** Biblioteket `@xeokit/xeokit-convert` exponerar `XKTModel` som en builder-klass. Strategin:

1. Parsa IFC/GLB till en `XKTModel` (det gör vi redan i `convertToXktWithMetadata`)
2. Efter `xktModel.finalize()` har modellen `metaObjects` med IFC-hierarki (typ, parent)
3. För varje `IfcBuildingStorey`:
   - Skapa en **ny** `XKTModel`
   - Kopiera alla entities vars metaObject-parent-kedja pekar på just den storeyn
   - Kopiera tillhörande meshes, geometries, textures
   - `finalize()` + `writeXKTModelToArrayBuffer()`
   - Ladda upp till Storage som en separat chunk-fil

### Komplexitet och risker

| Aspekt | Bedömning |
|---|---|
| Hierarki-traversering | Medel -- metaObjects har `parentMetaObjectId`, behöver rekursiv walk |
| Geometry-kopiering | **Hög risk** -- `XKTModel` har inte en publik "copy entity"-API; vi måste manuellt kopiera mesh/geometry/texture-data via interna arrayer |
| Filstorlek | Summan av chunks > originalet pga duplicerad shared geometry (t.ex. väggar som spänner flera plan) |
| IFC vs GLB | IFC har rikare hierarki; GLB från ACC saknar ofta tydlig storey-koppling |
| Webbläsarminne | Stor IFC → XKTModel tar redan mycket RAM; att skapa N ytterligare XKTModel-instanser multiplicerar |

### Alternativ approach: Viewer-side filtering (enklare, fungerar nu)

Istället för att faktiskt split-a binären kan viewern ladda hela XKT-filen men **visa/dölja per storey** genom att:
- Mappa entity → storey via metaObjects (redan delvis implementerat i floor-isolation-logiken)
- Sätta `visible=false` på entities som inte tillhör aktiv våning

**Detta är vad viewern redan gör idag** för floor-isolation i 2D-mode. Den faktiska prestandavinsten av binär splitting kommer främst vid **initial load time** (mindre fil att ladda), inte vid rendering (xeokit hanterar visibility-culling effektivt).

### Rekommendation

Verklig binär XKT-splitting kräver att vi gräver i `XKTModel`-internals (mesh-arrayer, geometry-buffers) vilket är fragilt och svårtestat. **Den pragmatiska vägen** som ger mest effekt per insats:

1. **Prioriterad laddning** (redan stöd i DB-schemat): ladda synlig vånings chunk först → rendera snabbt → ladda resten i bakgrunden
2. **Server-side splitting via IFC** (edge function): Använd `web-ifc` i en edge function för att extrahera geometri per storey **innan** XKT-konvertering, dvs skapa separata IFC-subset → konvertera var och en till XKT
3. **Behåll nuvarande metadata-approach** tills vi har en edge function med tillräcklig RAM/timeout

### Vad som behövs för att implementera server-side splitting

| Steg | Beskrivning |
|---|---|
| 1. Edge function `xkt-split` | Tar emot IFC-fil från Storage, parsar med web-ifc, identifierar storeys, extraherar subset per storey |
| 2. Per-storey konvertering | Varje subset → `parseIFCIntoXKTModel` → `writeXKTModelToArrayBuffer` |
| 3. Upload chunks | Ladda upp till `xkt-models` bucket med `storey_fm_guid` och `is_chunk=true` |
| 4. Viewer loader update | Ändra modell-laddaren att kolla `is_chunk` och ladda synlig våning först |

**Begränsning:** Deno edge functions har 150s timeout och begränsat minne. Stora IFC-filer (>50 MB) kan behöva en extern worker eller klient-side approach.

### Slutsats

Det **går tekniskt** men kräver antingen:
- (A) Grävande i XKTModel-internals (klient-side, fragilt), eller
- (B) Server-side IFC-parsing med web-ifc i en edge function (robustare men begränsad av edge function-resurser)

Vill du att jag implementerar approach (B) med en edge function, eller ska vi fokusera på de andra viewer-problemen (2D-sync, click-through, prestanda, context menu) först?

