

## Plan: Ilean Dokumentsökning + Tandem-stil Rumsvy

### Del 1: Ilean Assistent — Full dokumentsökning

**Mål**: Ge Ilean-assistenten samma kapacitet som Senslincs Ilean men med Geminus UI. Idag skickas frågor via `ilean-ask` som bara proxar till Senslincs Ilean API (eller fallback till Lovable AI utan dokument-tillgång). Vi lägger till RAG-sökning som en parallell källa.

**Ändringar:**

1. **`supabase/functions/senslinc-query/index.ts`** — I `ilean-ask`-action: efter att Senslinc Ilean-endpoints testats, och innan Lovable AI-fallback, lägg till ett steg som anropar `rag-search` edge function med frågan + `buildingFmGuid`. Om RAG returnerar relevanta chunks, injicera dem som kontext i AI-prompten istället för att bara säga "kunde inte nås". Detta ger Ilean tillgång till alla indexerade dokument.

2. **`src/hooks/useIleanData.ts`** — Utöka `sendMessage` med en valfri `sources`-array i svaret som returneras från edge function. Lägg till `sources` i state så UI:t kan visa dem.

3. **`src/components/chat/IleanButton.tsx`** — Visa dokumentkällor under assistant-svar (badges med filnamn, liknande RagSearchTab). Uppdatera startfrågor med mer dokumentspecifika frågor. Lägg till en liten "Söker i X dokument..."-indikator under laddning.

### Del 2: Tandem-stil rumsvy (Cutaway)

**Mål**: När ett rum väljs i FilterPanel ska rummet och dess innehåll visas i full 3D, medan allt annat på samma våningsplan renderas som genomskinlig 2D/wireframe (x-ray), exakt som Autodesk Tandem-bilden.

**Nuvarande beteende** (rad 1060-1088 i ViewerFilterPanel): Vid rum-selektion visas redan x-ray för kontext-objekt och rummet visas solid. Men det saknar:
- Att visa hela byggnaden i x-ray (inte bara dölja den)
- Att behålla rumsinnehåll (möbler, installationer) som solid
- Att flyga kameran till rummet automatiskt

**Ändringar i `src/components/viewer/ViewerFilterPanel.tsx`:**

1. **Utvidga space-filter logiken** (~rad 886-910): När rum är valda, samla inte bara parent-level-context utan ALLA objekt i scenen. Sätt allt till xray UTOM:
   - Objekt som ligger inuti det valda rummet (barn till IfcSpace i metaScene-hierarkin)
   - Rumsobjektet självt
   
2. **Traversera metaScene-hierarkin** för att hitta alla entities som tillhör rummet (väggar, dörrar, möbler, installationer som har rummet som spatial container).

3. **Automatisk kameranavigering**: Efter applicering av rum-filter, gör `viewer.cameraFlight.flyTo({ aabb: roomBoundingBox })` för att fokusera på rummet.

4. **X-ray material-inställningar**: Justera `xrayMaterial` till ljusgrå wireframe (liknande Tandem: `fillAlpha: 0.08`, `edgeAlpha: 0.2`) för att ge den 2D-planritnings-effekten.

### Teknisk sammanfattning

| Fil | Ändring |
|-----|---------|
| `supabase/functions/senslinc-query/index.ts` | RAG-sökning som fallback i ilean-ask, returnera sources |
| `src/hooks/useIleanData.ts` | Hantera sources i svar, utöka state |
| `src/components/chat/IleanButton.tsx` | Visa källdokument, bättre startfrågor, laddningsindikator |
| `src/components/viewer/ViewerFilterPanel.tsx` | Tandem-stil cutaway: allt xray utom valt rum + dess innehåll, auto-fly-to |

