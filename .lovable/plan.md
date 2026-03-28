
## Plan: Gör Geminus AI snabb, ge riktiga nästa-frågor och växla till Viewer på mobil

### Vad som faktiskt orsakar problemet
1. `gunnar-chat` är fortfarande långsam eftersom den kör flera AI-rundor innan svar:
   - loggarna visar 3–4 rundor och ~22–27s total tid
   - `search_assets` timeoutar ibland i databasen
2. “2–3 nästa frågor” finns bara som instruktion i prompten idag, men inte som strukturerad data i svaret.
3. På mobil färgar AI i viewern via events, men chatten ligger kvar ovanpå och appen växlar inte tydligt till 3D/viewer-läge.

### Implementation
#### 1) Snabba upp Gunnar med riktig fast-path
Uppdatera `supabase/functions/gunnar-chat/index.ts` så att vanliga frågor inte går genom full AI-loop.
- Lägg till en server-side intent-router för vanliga typer:
  - visa/highlight/filter system eller kategori
  - objekt i aktivt rum
  - temperatur / CO2 / humidity i aktivt rum
  - enkel byggnadsöversikt
- Kör RPC direkt och bygg strukturerat svar direkt server-side.
- Använd AI-fallback bara när frågan är mer fri/oklar.

Effekt:
- typiska viewer-frågor går från flera AI-rundor till 1 backend-runda
- mindre risk för timeout

#### 2) Begränsa AI-loopen hårt för fallback
I samma edge function:
- sänk `MAX_TOOL_ROUNDS` från 4 till 2
- korta ned prompten och conversation context
- prioritera att AI ska göra exakt 1 dataverktyg + `format_response`
- returnera fallback snabbare om verktyg inte leder framåt

Effekt:
- även svårare frågor blir snabbare och mer förutsägbara

#### 3) Optimera sökningen som timeoutar
Skapa en databas-migration för att minska risken att `search_assets_rpc` timeoutar.
- lägg till index för sökning i `assets`
- justera sökfunktionen så den:
  - prioriterar byggnadsscope när `building_guid` finns
  - returnerar färre, bättre träffar först
  - undviker breda dyra sökningar i onödan

Trolig riktning:
- trigram-index eller motsvarande på `name`, `common_name`, `asset_type`
- lägre standardlimit för AI-anrop

#### 4) Gör “nästa frågor” till riktig UI-data
Utöka `AiStructuredResponse` och `format_response` med t.ex.:
- `suggestions: string[]`

Ändringar:
- `supabase/functions/gunnar-chat/index.ts`
  - `format_response` ska alltid inkludera 2–3 förslag
  - om AI inte ger förslag, skapa server-side fallback-förslag utifrån intent/resultat
- `src/components/chat/GunnarChat.tsx`
  - rendera förslagen som riktiga klickbara chips/knappar under senaste assistantsvaret
  - klick på ett förslag skickar det direkt som ny fråga

Effekt:
- användaren får alltid 2–3 tappbara nästa steg
- inte beroende av markdown eller att modellen “råkar” följa prompten

#### 5) Växla tydligt till Viewer på mobil när AI färgar/markerar
Inför ett separat UI-event för mobil viewer-navigation, t.ex. `AI_VIEWER_FOCUS_EVENT`.
- `GunnarChat.tsx`
  - när action är `highlight`, `filter` eller `colorize`:
    - dispatcha viewer-kommandot som idag
    - dispatcha även “focus viewer”-event
- `MobileViewerPage.tsx`
  - lyssna på eventet
  - växla till `3d` om användaren är i 2D/360/split
  - stäng filter-sheet om det behövs
- `GunnarButton.tsx`
  - på mobil: minimera/stäng chatten automatiskt efter viewer-action
  - behåll på desktop som flytande panel

Effekt:
- när AI färgar in något ser användaren resultatet direkt
- mindre känsla av att “inget hände”

#### 6) Lägg till tydlig CTA i chatten
I `GunnarChat.tsx`, för svar som påverkar viewern:
- visa en liten knapprad, t.ex.
  - “Visa i 3D”
  - “Behåll chatten öppen” / “Stäng chatten”
- på mobil ska “Visa i 3D” vara extra tydlig även om auto-switch redan sker

### Filer som påverkas
- `supabase/functions/gunnar-chat/index.ts`
- `src/components/chat/GunnarChat.tsx`
- `src/components/chat/GunnarButton.tsx`
- `src/components/viewer/mobile/MobileViewerPage.tsx`
- ny migration i `supabase/migrations/...`

### Tekniska detaljer
- Behåll nuvarande viewer-event för färgning/highlight; lägg bara till ett separat event för UI-fokus.
- Gör suggestions strukturerade i JSON istället för markdown i `message`.
- Server-side fast-path bör täcka de vanligaste svenska kommandona först, eftersom det är där största vinsten finns.
- Databassökningen är en del av problemet; loggarna visar statement timeout i `search_assets`.

### Resultat efter implementation
- Geminus AI svarar mycket snabbare på vanliga frågor
- varje svar visar 2–3 klickbara nästa frågor
- på mobil växlar appen automatiskt till rätt viewer-läge när AI färgar eller markerar objekt
