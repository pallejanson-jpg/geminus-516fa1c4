

# Geminus AI — Tre kritiska buggar att fixa

## Problem 1: Första frågan besvaras med hälsning istället för data

**Orsak**: När chatten öppnas sätts ett greeting-meddelande som `messages[0]` (rad 170). I `sendMessage` (rad 386) filtreras det bort med `filter((_, i) => i > 0)` — men problemet är att `trimHistory` sedan körs på de kvarvarande meddelandena. Med bara ett user-meddelande skickas bara den till backend.

Problemet är i backend: `detectSimpleIntent` (rad 1309-1325) kontrollerar sista meddelandet. Om det matchar ett "greeting"-mönster, returneras en snabbväg utan verktygsanrop. Men detta borde inte matcha på "vilka byggnader har du information om". 

**Troligare orsak**: Chatten skickar `context` utan `currentBuilding` (inget byggnadskontext). AI:n ser en generell fråga utan kontext och svarar med `resolve_building_by_name` eller `query_assets` — men den träffar "Småviken" och svarar med info om den istället för att lista alla byggnader. Prompten säger: *"When no building context is set and user asks 'vilka byggnader har jag', use query_assets with category='Building'"* — men AI:n kanske inte matchar frågan korrekt.

**Fix (backend)**: Förstärk prompten med tydligare instruktion och lägg till `list_buildings` som preferred tool vid "vilka byggnader"-frågor. Lägg till ett explicit exempel i prompten.

## Problem 2: `selectBuilding`-knappen slänger ut användaren

**Orsak**: I `selectBuilding` (rad 639-652):
- `setSelectedFacility(...)` anropas (rad 643-648) — detta uppdaterar `AppContext`
- Sedan `sendMessage("Jag menar ${bName}")` (rad 650)

Men `setSelectedFacility` triggar `useEffect` (rad 165-176) som **nollställer messages** om `messages.length === 0 || messages.length === 1`. I standalone-läge (`isStandaloneContext`), anropas `setSelectedFacility` inte — men `sendMessage` skickas utan att kontexten uppdaterats i backend-anropet.

I det **inbäddade** fallet (inne i Geminus) triggar `setSelectedFacility` potentiellt en navigation via `AppContext` som ändrar `activeApp` eller navigerar till en annan vy — därav "utkastad".

**Fix**: 
- I `selectBuilding`, uppdatera chatten med ny `context` istället för att anropa `setSelectedFacility` direkt
- Skicka `sendMessage` med explicit byggnadskontext i meddelandet, och uppdatera `context` objekt lokalt
- I standalone: ingen navigation alls, bara uppdatera chatten med ny kontextinfo

## Problem 3: TTS (Text-to-Speech) fungerar inte

**Orsak**: `speakAssistant` anropas från `useEffect` (rad 469-477) som triggas av `messages`-ändring. På iOS kräver `speechSynthesis.speak()` en user gesture — programmatiskt anrop blockeras tyst.

**Fix**: Implementera iOS TTS-unlock: vid första klick på speaker-knappen, skapa en tom `SpeechSynthesisUtterance` och anropa `speak()` — detta "låser upp" API:t för framtida programmatiska anrop.

## Filer att ändra

| Fil | Ändring |
|-----|--------|
| `supabase/functions/gunnar-chat/index.ts` | Förstärk systemprompt: explicit hantering av "vilka byggnader"-frågor, förhindra att AI ger info om EN byggnad när alla efterfrågas |
| `src/components/chat/GunnarChat.tsx` | (1) Fix `selectBuilding` — skicka kontextuppdatering till chatten utan `setSelectedFacility` navigation. (2) iOS TTS-unlock vid toggle av speaker-knappen. (3) Förhindra att greeting-reset triggas vid byggnadsval |

## Detaljerade ändringar

### Backend (gunnar-chat/index.ts)
- Lägg till i systemprompten: `"CRITICAL: When user asks 'vilka byggnader har du/jag' or 'which buildings', ALWAYS use the list_buildings tool. Do NOT use query_assets or resolve_building_by_name for this. Present ALL buildings as selectBuilding buttons."`
- Lägg till `list_buildings` som prioriterat verktyg i disambiguering

### Frontend (GunnarChat.tsx)

**selectBuilding-fix**:
```typescript
case "selectBuilding":
  if (action.buildingFmGuid) {
    const bName = action.buildingName || 'byggnaden';
    // Don't call setSelectedFacility — it triggers context reset and navigation
    // Instead, send a follow-up message that includes the building context explicitly
    void sendMessage(`Jag vill veta mer om ${bName} (building: ${action.buildingFmGuid})`);
  }
  break;
```

Dessutom: uppdatera `context` som skickas till backend i `streamChat` så att den inkluderar vald byggnad utan att trigga AppContext.

**iOS TTS-unlock**:
```typescript
const ttsUnlockedRef = useRef(false);
const toggleVoiceOutput = () => {
  if (!ttsUnlockedRef.current && 'speechSynthesis' in window) {
    const unlock = new SpeechSynthesisUtterance('');
    window.speechSynthesis.speak(unlock);
    ttsUnlockedRef.current = true;
  }
  setVoiceOutputEnabled(prev => !prev);
};
```

**Greeting-reset skydd**:
Ändra useEffect (rad 165-176) så att den INTE nollställer messages om konversationen har fler än 1 meddelande.

