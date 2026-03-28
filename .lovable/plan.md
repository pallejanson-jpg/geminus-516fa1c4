

## Byt TTS till Deepgram Aura (ta bort ElevenLabs)

### Nuläge
- TTS använder webbläsarens `speechSynthesis` i `GunnarChat.tsx`
- Inställningarna refererar till ElevenLabs-röster men de används aldrig
- Edge function `elevenlabs-tts` finns men anropas aldrig
- `DEEPGRAM_API_KEY` finns redan som secret

### Vad som ändras

#### 1. Skapa edge function: `deepgram-tts`
- POST med `{ text, model, speed }`
- Anropar `https://api.deepgram.com/v1/speak?model={model}&encoding=mp3`
- Använder `DEEPGRAM_API_KEY` (redan tillagd)
- Returnerar rå MP3-bytes
- Default-modell: `aura-2-thalia-en` (stöder flerspråkigt)

#### 2. Skapa TTS-hjälpare: `src/lib/deepgram-tts.ts`
- Funktion `speakWithDeepgram(text, model, speed)` som:
  - Anropar `deepgram-tts` edge function via `fetch`
  - Skapar `Audio`-objekt från blob
  - Returnerar Audio-instans
- Fallback till browser TTS vid fel

#### 3. Uppdatera `GunnarChat.tsx`
- Byt `speakText` från `SpeechSynthesisUtterance` till `speakWithDeepgram`
- Behåll play/stop per meddelande

#### 4. Uppdatera `GunnarSettings.tsx`
- Byt ut ElevenLabs-röstlistan mot Deepgram Aura-röster:
  - `aura-2-thalia-en` — Thalia (varm, balanserad)
  - `aura-2-andromeda-en` — Andromeda (mjuk)
  - `aura-2-arcas-en` — Arcas (djup, manlig)
  - `aura-2-asteria-en` — Asteria (klar)
  - `aura-2-apollo-en` — Apollo (självsäker)
  - m.fl.
- Testhastighet-knappen anropar Deepgram istället för browser TTS
- Ta bort `ELEVENLABS_VOICES`-arrayen

#### 5. Ta bort `elevenlabs-tts` edge function (valfritt)
- Kan tas bort eller behållas som oanvänd

### Filer
- **Ny**: `supabase/functions/deepgram-tts/index.ts`
- **Ny**: `src/lib/deepgram-tts.ts`
- **Edit**: `src/components/chat/GunnarChat.tsx` — byt speakText
- **Edit**: `src/components/settings/GunnarSettings.tsx` — Deepgram-röster

### Säkerhet
- API-nyckeln exponeras aldrig i frontend
- All TTS-kommunikation via edge function

