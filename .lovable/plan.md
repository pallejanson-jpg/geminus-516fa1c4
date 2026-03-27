

## Plan: Integrate ElevenLabs TTS into Gunnar AI Chat

### Overview

Replace the browser Web Speech API (`SpeechSynthesisUtterance`) in `GunnarChat.tsx` with ElevenLabs high-quality TTS via an edge function. This gives natural, multilingual voice output for the AI assistant.

### Prerequisites

Connect the ElevenLabs connector to get the API key as an environment variable. No ElevenLabs connection exists yet in this workspace.

### Changes

#### 1. Connect ElevenLabs connector
Use the ElevenLabs connector (`elevenlabs`) to link API credentials to the project.

#### 2. Create edge function `supabase/functions/elevenlabs-tts/index.ts`
- Accepts `{ text, voiceId? }` POST body
- Calls ElevenLabs `/v1/text-to-speech/{voiceId}` with `eleven_multilingual_v2` model
- Returns raw MP3 audio bytes
- Uses CORS headers, validates input
- Default voice: a suitable multilingual voice (e.g. "Daniel" for Swedish/English)

#### 3. Update `src/components/chat/GunnarChat.tsx`
Replace the `speakAssistant` function:
- Instead of `SpeechSynthesisUtterance`, call the `elevenlabs-tts` edge function via `fetch()`
- Receive audio blob, create `URL.createObjectURL()`, play via `new Audio()`
- Keep `isSpeaking` state management (set on play, clear on ended)
- Remove `getBestVoice`, `cleanSpeechText` complexity (ElevenLabs handles prosody natively)
- Keep the voice output toggle button as-is
- Add a stop function that pauses/removes the current audio element

#### 4. Update `src/components/settings/GunnarSettings.tsx`
- Replace browser voice selector with a simple ElevenLabs voice picker (dropdown with a few preset voices)
- Remove browser-specific voice listing (`useAvailableVoices` hook)
- Keep language selector (pass to edge function for model selection)

### File changes

| File | Change |
|---|---|
| `supabase/functions/elevenlabs-tts/index.ts` | New: edge function for TTS |
| `src/components/chat/GunnarChat.tsx` | Replace `speakAssistant` with ElevenLabs fetch + Audio playback |
| `src/components/settings/GunnarSettings.tsx` | Simplify voice picker to ElevenLabs presets |

