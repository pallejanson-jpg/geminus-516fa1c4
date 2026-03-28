
## Reviderad plan: Djuplodande analys och stabilisering av Jenny AI

### Vad den djupa analysen redan visar
Det här är inte ett “lite sämre prompt”-problem. Det är ett arkitekturfel i hur AI:n tolkar input och hur knappar fungerar.

#### 1) Knapparna är felkonstruerade
I dag skickas knapptexten rakt tillbaka som ett nytt användarmeddelande via `sendMessage(b)`. Då tolkar backend texten bokstavligt:
- `Visa alla system` blir system-sökning på `"alla system"`
- `Visa alla tillgångar` blir system-sökning på `"alla tillgångar"`
- `Finns det andra typer av utrustning?` blir system-sökning på `"andra typer av utrustning?"`

Detta är huvudorsaken till de meningslösa svaren i senaste chatten om Småviken.

#### 2) Fast-pathen är för aggressiv och felroutar intent
`detectViewerIntent()` fångar nästan allt som börjar med “visa”, “filtrera”, “finns det”, osv och skickar det till `show_system`. Det gör att många frågor aldrig får rätt handler.

#### 3) Kort input mappas till fel dataverktyg
`detectShortInput()` mappar objekt som `Dörrar` till `show_system`, som i sin tur använder `get_assets_by_system`. Men dörrar hör ofta hemma i `category`, inte `asset_type`. Samma problem finns för rum, våningar och vissa objekt.

#### 4) Prompten säger något som koden inte kan uppfylla
Prompten instruerar modellen att “call data tool AND format_response in the SAME round”, men själva loopen fungerar sekventiellt:
- AI-anrop
- tool calls
- tool-resultat tillbaka
- nytt AI-anrop

Det betyder att modellen får instruktioner som är tekniskt omöjliga, vilket ökar risken för felbeteende och extra rundor.

#### 5) Samma svarsknappar återkommer utan att ha riktig backend-logik
Fallback-knappar som:
- `Visa alla system`
- `Sök utrustning`
- `Visa alla tillgångar`
saknar deterministisk serverlogik. AI:n genererar alltså ofta UI-val som systemet inte faktiskt kan utföra korrekt.

#### 6) Konversationsminnet är för tunt för uppföljningar
Bara kort text sparas i `gunnar_conversations`. Strukturerad state som senaste `response_type`, `buttons`, `filters`, vald intent och senaste resultat sparas inte. Därför blir “ja”, “visa den”, “öppna den där”, osv svaga uppföljningar.

#### 7) Latensen är delvis självförvållad
Senaste loggarna visar ett typiskt 3-stegsflöde:
- round 1: `get_building_summary`
- round 2: `get_assets_by_system`
- round 3: `format_response`

Det är bättre än tidigare, men fortfarande för långsamt för vanliga frågor som egentligen borde lösas helt utan AI-loop.

---

## Vad jag föreslår att vi bygger nu

### A. Byt från textknappar till strukturerade actions
I stället för `buttons: string[]` ska backend returnera något i stil med:
```text
buttons: [
  { id: "building_overview", label: "Byggnadsöversikt", action: "building_summary" },
  { id: "show_all_rooms", label: "Visa alla rum", action: "category_query", payload: { category: "Space" } }
]
```

Frontend ska skicka tillbaka knappens action/payload, inte etiketten som fritext.

Detta är den viktigaste fixen.

### B. Inför en ny deterministisk intent-router före AI
Ny prioritet:
1. `detectSimpleIntent`
2. `detectButtonAction`
3. `detectShortInput`
4. `detectViewerIntent`
5. Full AI-loop

Målet är att vanliga flöden aldrig ska gå via modellen om de kan lösas deterministiskt.

### C. Dela upp fast-path i riktiga intents
I stället för att nästan allt blir `show_system` ska vi ha separata intents:
- `building_summary`
- `category_query`
- `system_query`
- `room_query`
- `floor_query`
- `issue_query`
- `search_prompt`

Exempel:
- `Dörrar` → `category_query("Door")`
- `Rum` → `category_query("Space")`
- `Ventilation` → `system_query("ventilation")`
- `Visa plan 2` → `floor_query("2")`
- `Öppna ärenden` → `issue_query()`

### D. Gör knapparna till förstklassiga handlingar i backend
Lägg till `executeButtonAction()` med explicita handlers för minst:
- Byggnadsöversikt
- Visa alla rum
- Visa alla tillgångar
- Visa alla system
- Visa ventilation
- Öppna ärenden
- Sök utrustning
- Visa i modell
- Filtrera per våning
- Visa detaljer

Då slutar systemet tolka sina egna knappar som fria frågor.

### E. Rätta datamappningen per domän
Backend ska välja rätt query beroende på typ:
- kategoriobjekt → `get_assets_by_category`
- system/teknik → `get_assets_by_system`
- rumsinnehåll → `get_assets_in_room`
- fri sökning → `search_assets`
- viewer-highlight → `get_viewer_entities` efter att rätt datamängd hittats

Detta löser att `Door`, `Space`, plan och utrustning blandas ihop.

### F. Förenkla AI-loopens uppdrag kraftigt
AI:n ska användas för:
- tolkning av svårare frågor
- formulering av svar
- generering av nästa steg

AI:n ska inte bära huvudansvaret för vanliga handlingsflöden som redan är kända.

Prompten ska därför justeras så att den inte lovar “same round”-beteende som koden inte stödjer.

### G. Spara strukturerad samtalsstate
Utöka sparad kontext för senaste svaret:
- senaste intent
- senaste building_guid
- senaste action
- senaste filters
- senaste buttons/actions
- senaste asset_ids

Det gör att uppföljningar som “ja”, “visa dem”, “öppna den”, “nästa steg” kan fungera på riktigt.

### H. Minska latens genom att flytta fler frågor från AI till kod
Följande ska helst gå utan full AI-loop:
- byggnadsöversikt
- visa rum
- visa system
- visa objektkategori
- öppna ärenden
- frågor om aktuell byggnad
- kort input med 1–4 ord

Detta ger både snabbare svar och mycket högre träffsäkerhet.

---

## Filer som bör ändras
- `supabase/functions/gunnar-chat/index.ts`
- `src/components/chat/GunnarChat.tsx`

---

## Teknisk riktning
### Backend
- byt `buttons: string[]` till strukturerade knappobjekt
- lägg till `detectButtonAction()` och `executeButtonAction()`
- bryt ut `show_system` till flera tydliga intents
- korrigera prompten så den matchar faktisk loop
- spara mer strukturerad konversationsstate

### Frontend
- rendera knappobjekt i stället för textknappar
- skicka action/payload tillbaka till backend
- behåll suggestions som fritext endast när det verkligen är fria följdfrågor
- koppla viewer-actions bara till explicita responsobjekt

---

## Förväntat resultat
Efter denna ombyggnad ska Jenny AI:
- sluta svara med nonsens på egna knappar
- ge rätt svar på kort input som `Småviken`, `Dörrar`, `Ventilation`
- bli snabbare i vanliga frågor
- fungera mer som ett interaktivt gränssnitt än en osäker chatbot
- klara uppföljningar bättre tack vare sparad state

---

## Viktig slutsats
Det allvarliga felet är inte att AI:n “inte förstår dig”, utan att systemet runt AI:n just nu förstör intenten:
- fel knappmodell
- fel routning
- fel query-val
- för mycket ansvar lagt på modellen

Det är därför du upplever att den fungerar “otroligt dåligt” trots att instruktionerna är tydliga. Problemet sitter främst i orkestreringen, inte i att du beskrivit fel.
