

## Plan: Geminus AI — Interaktivt gränssnitt med knappar, smart tolkning och noll stopp-svar

### Problem idag
1. Geminus AI svarar som en chatbot med fritext — inga klickbara knappar
2. "Jag kunde inte slutföra sökningen" returneras vid max rounds
3. Kort input som "Småviken", "Dörrar", "Ventilation" fångas inte av fast-path
4. Suggestions är generiska fallbacks, inte kontextmedvetna
5. Rad 1006 kastar alltid bort AI:ns egna suggestions

### Åtgärder

#### 1) Utöka svarsformatet med `buttons` och `type`-fält
Lägg till `buttons: string[]` och `type: string` i:
- `format_response` tool-definition (backend)
- `AiStructuredResponse` interface (frontend)
- `GunnarChat.tsx` rendering

Buttons renderas som större, tydliga actionknappar (inte bara chips). Next-steps/suggestions renderas som mindre sekundära chips.

#### 2) Massivt bredda fast-path för kort input
I `detectViewerIntent` / ny `detectShortIntent`:
- **Enbart byggnadsnamn** → `building_summary` (matcha mot `context.currentBuilding.name`)
- **Enbart objekttyp** som "Dörrar", "Fönster", "Pumpar" → `show_system`
- **Enbart system** som "Ventilation", "El", "VVS" → `show_system`
- **Kort action** som "Visa plan 2", "Öppna dokument" → dedicated fast-path

Regex-lista utökas kraftigt med svenska objekttyper och systemnamn.

#### 3) Eliminera stopp-svar vid max rounds
Rad 1020-1032: Istället för "Jag kunde inte slutföra sökningen":
- Leta bakåt i `conversation` efter senaste `assistant`-meddelande med content
- Om det finns, använd det + generera suggestions
- Om inte, ge ett smart fallback: "Jag har begränsad information om detta. Här är vad du kan göra:" + knappar

#### 4) Bevara AI:ns suggestions, fallback bara om tomma
Rad 1006: Ändra till:
```
suggestions: formatResponseResult.suggestions?.length > 0
  ? formatResponseResult.suggestions
  : generateFallbackSuggestions(formatResponseResult, context)
```

#### 5) Uppdatera systemprompt med nytt format
Instruera AI:n att:
- Alltid inkludera `buttons` med 2-3 klickbara handlingar
- Alltid inkludera `suggestions` med 2-3 nästa steg
- Använda `type`-fält: `answer`, `navigation`, `data_query`, `action`
- Max 2-3 meningar i `message`
- Aldrig skriva stopp-svar

#### 6) Rendera buttons som stora actionknappar i GunnarChat
I `renderMessages()`:
- Under varje assistant-svar: visa `buttons` som primärknappar med ikoner
- Under knappar: visa `suggestions` som sekundära chips
- Klick på button → skicka som ny fråga (samma som suggestions men visuellt tydligare)

#### 7) Smart fallback i fast-path
Om data saknas, ge ändå ett informativt svar:
- "Det finns inga ventilationsobjekt registrerade ännu. Du kan:"
- Knappar: "Visa alla system", "Importera data", "Byggnadsöversikt"
- Aldrig tomt svar

### Filer som ändras
- `supabase/functions/gunnar-chat/index.ts` — utökat format, bredare fast-path, borttagen stopp-text, bevarade suggestions
- `src/components/chat/GunnarChat.tsx` — `buttons` i interface + rendering som actionknappar

### Tekniska detaljer
- `buttons` mappar till samma `sendMessage()` som suggestions
- `type` sparas men används primärt för framtida routing (t.ex. navigationsknapp → dispatcha event)
- Fast-path kort-input: matcha mot lista av kända svenska BIM-termer + fuzzy mot byggnadsnamn
- Systemprompt kortas ned och fokuseras på det nya formatet

