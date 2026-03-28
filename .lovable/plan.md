

## Plan: Fix Gunnar AI — sluta fastna, ge riktiga svar

### Rotorsak (från loggarna)
**5 av 7 senaste anrop slutar med "max rounds reached"** och användaren får fallback-text istället för riktigt svar. Mönstret:
- Round 1: AI anropar data-tool (t.ex. `list_buildings`, `get_assets_by_category`)
- Round 2: AI anropar ÄNNU en data-tool (t.ex. `get_building_summary`, `get_viewer_entities`) istället för `format_response`
- MAX_TOOL_ROUNDS=2 → loopen tar slut → fallback-svar

AI:n hinner aldrig kalla `format_response` eftersom den vill göra 2 data-anrop + 1 format_response = 3 rundor, men bara 2 är tillåtna.

Dessutom: AI:n anropar fortfarande `resolve_building_by_name` trots att byggnaden redan finns i kontexten (logg 07:24:44).

### Åtgärder i `supabase/functions/gunnar-chat/index.ts`

#### 1) Tvinga `format_response` på sista rundan
På sista tillåtna rundan, sätt `tool_choice` till `{ type: "function", function: { name: "format_response" } }` istället för `"auto"`. Detta garanterar att AI:n alltid avslutar med ett strukturerat svar.

```text
Round 1: tool_choice="auto" → AI väljer data-tool
Round 2: tool_choice="auto" → AI väljer data-tool
Round 3: tool_choice=format_response (tvingat) → strukturerat svar
```

#### 2) Öka MAX_TOOL_ROUNDS till 3
Med tvingad format_response på sista rundan blir mönstret:
- 2 fria rundor för data
- 1 tvingad runda för format_response
- Totalt max 3 AI-anrop, men alltid ett riktigt svar

#### 3) Ta bort `resolve_building_by_name` från tools när byggnad redan finns i context
Om `context.currentBuilding.fmGuid` finns, filtrera bort `resolve_building_by_name` från tools-arrayen som skickas till AI:n. Då kan den inte slösa rundor på det.

#### 4) Fånga korta bekräftande svar i fast-path
Lägg till matchning för "ja", "ja tack", "okej", "yes", "sure" i `detectSimpleIntent`. Dessa ska ge ett kontextmedvetet svar baserat på senaste konversationen, inte skickas till AI-loopen.

### Fil som ändras
- `supabase/functions/gunnar-chat/index.ts`

### Förväntat resultat
- **0 "max rounds reached"** — varje anrop avslutas med `format_response`
- Snabbare svar (ingen bortkastad runda på `resolve_building_by_name`)
- Korta svar som "ja tack" hanteras direkt

