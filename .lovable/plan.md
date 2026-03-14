

## Fix: Geminus AI — tre problem

### Problem 1: AI svarar med fråga istället för att svara direkt
**Orsak**: Systemprompt-regeln "Ask at most ONE question at a time" (rad 1384) tolkas av modellen som att det är OK att ställa frågor. Den saknar en tydlig instruktion att **aldrig** svara med en fråga på en direkt datafråga.

**Fix** (`supabase/functions/gunnar-chat/index.ts`):
- Ändra systemprompten: lägg till regel "NEVER respond with a clarifying question when the user asks a specific data question. Always attempt to answer first using tools."
- Flytta "Ask at most ONE question at a time" till att vara villkorad: "Only ask a clarifying question when the query is genuinely ambiguous AND you cannot proceed with tools."

### Problem 2: Råa `[action:...]` tokens visas i svaret
**Orsak**: AI:n genererar ibland action-tokens som `[action:openViewer:guid]` utan markdown-länksyntax `[label](action:...)`. ReactMarkdown renderar dessa som ren text.

**Fix** (`src/components/chat/GunnarChat.tsx`):
- Lägg till en `stripRawActionTokens`-funktion som körs på assistentens content innan rendering.
- Regex: `\[action:[^\]]+\]` → ta bort helt (dessa tokens ska inte visas).
- Alternativt: konvertera dem till klickbara knappar genom att parsa `[action:type:param1:param2]` och skapa markdown-länksyntax, men enklast är att bara stripa dem eftersom de saknar label.

Uppdatera också systemprompten för att förstärka att action-tokens **måste** vara i markdown-länkformat `[Visa label](action:type:param)`, aldrig som `[action:type:param]`.

### Problem 3: Mekanisk röst (TTS)
**Orsak**: `speakAssistant` använder Web Speech API (`SpeechSynthesisUtterance`) som har begränsade röster. Koden prioriterar redan "natural/premium"-röster men resultatet beror på webbläsarens tillgängliga röster.

**Fix** (`src/components/chat/GunnarChat.tsx`):
- Förbättra prosody-tuningen: sänk `rate` till 0.85-0.90 (långsammare = mer naturligt), variera `pitch` något mellan segment (±0.05).
- Lägg till pauser mellan segment med tomma `SpeechSynthesisUtterance` (kort paus-trick).
- Öka segmenteringskvaliteten: splitta på komma/semikolon också, inte bara punkt.
- Lägg till `volume`-kontroll som undviker max volume (0.9 istället för 1.0).

Dessutom: stärk röstprioriteringen i `getBestVoice` — ge extra poäng till röster som innehåller "wavenet", "neural", "studio" (om tillgängliga via Chrome).

### Sammanfattning av filändringar

| Fil | Ändring |
|---|---|
| `supabase/functions/gunnar-chat/index.ts` | Uppdatera systemprompt: (a) förbjud frågor på direkt data-frågor, (b) kräv markdown-länkformat för actions |
| `src/components/chat/GunnarChat.tsx` | (a) `stripRawActionTokens` före rendering, (b) förbättra TTS prosody och röstpriortering |

