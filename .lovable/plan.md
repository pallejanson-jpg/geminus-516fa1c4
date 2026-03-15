

# Geminus AI — Lärande minne (Adaptive Memory)

## Idé
Geminus AI kan inte "tränas" i klassisk ML-mening (fine-tuning kräver GPU-infrastruktur), men vi kan bygga ett **adaptivt minnessystem** som ger samma upplevda effekt: assistenten lär sig av instruktioner, preferenser och korrigeringar och blir bättre ju mer den används.

## Arkitektur

```text
┌─────────────────────────┐
│  Användare ger feedback  │
│  "Kom ihåg att...",      │
│  "Nästa gång, gör X"    │
└────────┬────────────────┘
         ▼
┌─────────────────────────┐
│  gunnar-chat edge func  │
│  Detekterar "minnes-     │
│  instruktion" → sparar   │
│  i ai_memory-tabell     │
└────────┬────────────────┘
         ▼
┌─────────────────────────┐
│  Vid varje ny fråga:     │
│  Ladda relevanta minnen  │
│  → injicera i system-    │
│  prompt som kontext     │
└─────────────────────────┘
```

## Tre typer av "lärande"

1. **Användarinstruktioner** — "Kom ihåg att jag vill ha svar på engelska", "Visa alltid larmdata först"
2. **Korrigeringar** — "Nej, det var fel. Småviken har 5 våningar, inte 13" → sparas så att AI:n inte upprepar misstaget
3. **Frekvensbaserat** — systemet noterar vilka verktyg/byggnader som används mest och prioriterar dem

## Databasändringar

Ny tabell `ai_memory`:

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| id | uuid | PK |
| user_id | uuid | FK auth.users |
| building_fm_guid | text (nullable) | Byggnadsspecifikt minne |
| memory_type | text | 'instruction', 'correction', 'preference' |
| content | text | Minnesinnehållet |
| source_message | text | Användarens ursprungliga meddelande |
| created_at | timestamptz | |
| expires_at | timestamptz (nullable) | Valfritt utgångsdatum |

RLS: Användare kan bara läsa/skriva sina egna minnen.

## Edge function-ändringar (`gunnar-chat/index.ts`)

### 1. Nytt verktyg: `save_memory`
AI:n anropar detta när användaren ger en instruktion eller korrigering:
```
save_memory — "Save a user instruction or correction for future reference"
  params: content (string), memory_type (instruction|correction|preference), building_fm_guid (optional)
```

### 2. Minnesinjicering vid varje begäran
Före AI-anropet: ladda de senaste ~20 minnena för användaren (+ eventuellt byggnadsspecifika) och injicera dem som en `LEARNED CONTEXT`-sektion i systemprompt:
```
LEARNED CONTEXT (user preferences & corrections):
- "Visa alltid svar på engelska"
- "Småviken har korrekt 5 våningsplan"
- "Föredrar att se larmdata först"
```

### 3. System prompt-tillägg
Instruera AI:n att:
- Upptäcka när användaren ger en instruktion ("kom ihåg", "nästa gång", "jag föredrar")
- Anropa `save_memory` för att spara det
- Bekräfta kort: "Noterat! Jag kommer ihåg det."
- Använda `LEARNED CONTEXT` aktivt vid framtida svar

## UI-ändring (valfritt, ej i första iteration)
Inget nytt UI behövs — allt sker via chatten. Användaren säger "Kom ihåg att..." och Geminus AI sparar det.

## Sammanfattning
- **1 ny tabell** (`ai_memory`) med RLS
- **1 nytt verktyg** (`save_memory`) i edge function
- **Minnesladding** vid varje begäran (~5 rader kod)
- **System prompt-tillägg** (~10 rader)
- Ingen ML-infrastruktur krävs — allt körs inom befintlig arkitektur

