

## Plan: Integrate ElevenLabs TTS (Manual API Key)

Since the connector was declined, we'll add the ElevenLabs API key as a manual secret and proceed with the integration.

### 1. Add ElevenLabs API Key as Secret
Use `add_secret` to request the user's `ELEVENLABS_API_KEY`.

### 2. Create Edge Function `supabase/functions/elevenlabs-tts/index.ts`
- POST `{ text, voiceId? }`
- Calls `https://api.elevenlabs.io/v1/text-to-speech/{voiceId}?output_format=mp3_44100_128`
- Model: `eleven_multilingual_v2` (supports Swedish + English)
- Default voice: Daniel (`onwK4e9ZLuTAKqWW03F9`) — good multilingual voice
- Returns raw MP3 bytes with CORS headers

### 3. Update `src/components/chat/GunnarChat.tsx`
- Replace `speakAssistant` (Web Speech API) with ElevenLabs fetch + `new Audio()` playback
- Remove `getBestVoice`, `cleanSpeechText` browser voice complexity
- Keep `isSpeaking` state, add stop via `audioRef.current.pause()`
- Use `fetch()` with `.blob()` (not `supabase.functions.invoke`) for binary audio

### 4. Update `src/components/settings/GunnarSettings.tsx`
- Replace browser voice list with ElevenLabs voice presets dropdown (Daniel, Alice, Lily, etc.)
- Remove `useAvailableVoices` hook
- Keep language selector

### File Changes

| File | Change |
|---|---|
| `supabase/functions/elevenlabs-tts/index.ts` | New edge function |
| `src/components/chat/GunnarChat.tsx` | Replace Web Speech TTS with ElevenLabs |
| `src/components/settings/GunnarSettings.tsx` | Simplify voice picker |

