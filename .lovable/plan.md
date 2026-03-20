

## Plan: ElevenLabs TTS + Chattbugg-fix

### Två problem att lösa

1. **Mekanisk röstkvalitet** → Byt från Web Speech API till ElevenLabs TTS
2. **Chatten stängs vid klick** → `closeAfterAction()` anropas vid viewer-actions som inte bör stänga chatten

---

### Steg 1: Koppla ElevenLabs-connector

Koppla ElevenLabs-connectorn till projektet. Denna ger en `ELEVENLABS_API_KEY` som miljövariabel.

### Steg 2: Edge function `elevenlabs-tts`

**Ny fil:** `supabase/functions/elevenlabs-tts/index.ts`

- Tar `{ text, voiceId?, lang? }` som input
- Anropar ElevenLabs TTS API (`eleven_multilingual_v2` modell) med streaming
- Returnerar audio/mpeg binärdata
- Standardröst: "Daniel" (`onwK4e9ZLuTAKqWW03F9`) för svenska, "Roger" (`CwhRBWXzGAHq8TQ4Fs17`) för engelska
- CORS-headers, `verify_jwt = false`

### Steg 3: Uppdatera `GunnarChat.tsx` — `speakAssistant`

Ersätt Web Speech API-anropet i `speakAssistant` (rad 253-283):

- Gör `fetch()` till `elevenlabs-tts` edge function med cleaned text
- Skapa `Audio()` objekt från blob-responsen och spela upp
- Behåll Web Speech API som fallback om ElevenLabs-anropet misslyckas
- Hantera `isSpeaking`-state korrekt (onplay/onended events)
- Stoppa pågående ljud vid nytt meddelande eller vid `cancel`

### Steg 4: Uppdatera `GunnarSettings.tsx` — röstval

Lägg till ElevenLabs-röstval i inställningarna:
- Dropdown med ElevenLabs-röster (Daniel, Roger, Sarah, Alice, Lily etc.)
- Spara vald `elevenLabsVoiceId` i `GunnarSettingsData`
- Behåll befintliga Web Speech-inställningar som fallback-konfiguration

### Steg 5: Fixa chatten som stängs

**Fil:** `src/components/chat/GunnarChat.tsx`

I `executeAction` (rad 549-684): Ta bort `closeAfterAction()`-anropet från actions som inte navigerar bort:
- `selectInTree` (rad 561) — dispatchar event, behöver inte stänga
- `showFloor` (rad 567) — dispatchar event
- `highlight` (rad 572) — dispatchar event
- `switchTo2D/3D` — dispatchar event
- `flyTo` — dispatchar event

Behåll `closeAfterAction()` BARA för actions som navigerar via `navigate()` (openViewer, showFloorIn3D, showDrawing, openViewer3D, isolateModel — men bara i icke-embedded läge där `navigate()` anropas).

---

### Sammanfattning

| Ändring | Fil |
|---|---|
| Koppla ElevenLabs connector | Connector setup |
| Ny edge function för TTS | `supabase/functions/elevenlabs-tts/index.ts` |
| Byt TTS-motor i chatten | `src/components/chat/GunnarChat.tsx` |
| ElevenLabs-röstval i settings | `src/components/settings/GunnarSettings.tsx` |
| Sluta stänga chatten vid actions | `src/components/chat/GunnarChat.tsx` |

