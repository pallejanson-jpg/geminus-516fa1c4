

# Plan: Snabba upp Geminus AI (Gunnar) med streaming

## Problem
Geminus AI väntar tills hela AI-svaret är klart innan det visas för användaren. ChatGPT och Copilot streamar token-för-token, vilket ger en upplevd svarstid på under 1 sekund. Nuvarande arkitektur:

1. **Frontend** (`GunnarChat.tsx`): Gör ett vanligt `fetch()` och väntar på `resp.json()` — inget stöd för streaming
2. **Backend** (`gunnar-chat/index.ts`): Kör 1–3 AI-rundor sekventiellt (tool-calling loop), varje runda väntar på fullständigt svar. Streaming är avstängt (`stream: false`)
3. **Resultat**: Användaren ser ingenting i 3–8 sekunder

## Lösning: Streaming av det sista AI-svaret

Hela tool-calling-loopen körs i bakgrunden som innan (den behöver fullständiga svar för att parsa tool calls), men det **sista steget** (format_response eller direkt svar) streamas token-för-token till klienten via SSE.

### Steg 1: Backend — streama sista AI-anropet

I `supabase/functions/gunnar-chat/index.ts`:

- Lägg till en hjälpfunktion som streamar ett SSE-svar till klienten
- När tool-loopen når sista rundan eller ett direkt svar: gör `callAI` med `stream: true`
- Skriv varje SSE-chunk direkt till en `ReadableStream` som returneras som response
- Fast-path-svar (hälsningar, knappar) returneras som vanligt JSON (de är redan snabba)
- Skicka en sista `data: {"done": true, "structured": {...}}` rad med knappar, suggestions och action-data

### Steg 2: Frontend — ta emot och rendera stream

I `src/components/chat/GunnarChat.tsx`:

- Ändra `callChat` så den läser `response.body` som en SSE-stream om Content-Type är `text/event-stream`
- Visa en "spinner" som omedelbart ersätts av de första orden som streamar in
- Parsa varje `data:` rad, extrahera `delta.content`, och uppdatera meddelandet progressivt
- När `done`-eventet kommer: parsa structured data (knappar, suggestions, action) och visa dem

### Steg 3: Visuell förbättring

- Lägg till en blinkande cursor-effekt ("▍") i slutet av meddelandet medan det streamar
- Visa knappar och suggestions först när streamen är klar

## Tekniska detaljer

```text
┌─────────────┐     SSE stream      ┌──────────────────┐
│  GunnarChat  │ ◄─────────────────  │  gunnar-chat fn  │
│  (frontend)  │   token by token    │  (edge function) │
└─────────────┘                      └──────────────────┘
                                       │
                                       ├─ Fast-path? → JSON (instant)
                                       │
                                       ├─ Tool round 1 → callAI(stream:false)
                                       ├─ Tool round 2 → callAI(stream:false)
                                       └─ Final answer → callAI(stream:true) → SSE
```

**Filer som ändras:**
- `supabase/functions/gunnar-chat/index.ts` — streaming av sista svaret
- `src/components/chat/GunnarChat.tsx` — SSE-parser och progressiv rendering

**Uppskattad förbättring:** Första token visas ~1–2s snabbare. Upplevd svarstid minskar drastiskt.

