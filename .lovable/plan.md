

## Replace Browser Speech-to-Text with Deepgram

### Current State
- STT uses browser's Web Speech API via `useWebSpeechRecognition.ts`
- Used in two places: `GunnarChat.tsx` and `VoiceControlButton.tsx`
- No Google Speech APIs exist in the codebase — the current implementation is browser-native
- TTS (text-to-speech) is separate and unaffected by this change

### What Changes

#### 1. Add Deepgram API key as a secret
- Store `DEEPGRAM_API_KEY` in backend secrets

#### 2. Create edge function: `deepgram-token`
- Returns a short-lived Deepgram API key or proxy token for WebSocket connections
- Frontend never sees the real API key
- Used by the real-time microphone transcription flow

#### 3. Create edge function: `transcribe-audio`
- Accepts POST with base64-encoded audio
- Sends to Deepgram prerecorded API (model: `nova-2`, language: `sv`, smart_format: true)
- Returns transcript as JSON
- Used for file upload transcription

#### 4. Rewrite `useWebSpeechRecognition.ts` → `useDeepgramSpeechRecognition.ts`
- New hook with same interface (`isListening`, `transcript`, `start`, `stop`, etc.)
- On `start`: fetches token from `deepgram-token` edge function, opens WebSocket to `wss://api.deepgram.com/v1/listen`
- Captures microphone via `navigator.mediaDevices.getUserMedia`
- Sends 250ms audio chunks via MediaRecorder
- Handles interim + final transcripts from Deepgram events
- On `stop`: closes WebSocket + MediaRecorder
- Keeps the same `UseWebSpeechRecognitionReturn` interface so consumers don't break

#### 5. Update consumers
- `GunnarChat.tsx`: swap import to new hook
- `VoiceControlButton.tsx`: swap import to new hook
- Both keep working with no API changes since the hook interface stays the same

#### 6. Add file transcription support
- New component or utility for drag-and-drop / file picker audio upload
- Converts file to base64, POSTs to `transcribe-audio` edge function
- Can be integrated into GunnarChat or VoiceControlButton as needed

### Files to create/modify
- **New**: `supabase/functions/deepgram-token/index.ts`
- **New**: `supabase/functions/transcribe-audio/index.ts`
- **New**: `src/hooks/useDeepgramSpeechRecognition.ts`
- **Edit**: `src/components/chat/GunnarChat.tsx` — swap hook import
- **Edit**: `src/components/voice/VoiceControlButton.tsx` — swap hook import
- **Keep**: `src/hooks/useWebSpeechRecognition.ts` — keep as fallback, or delete

### Security
- API key stored in backend secrets only
- Frontend uses short-lived token from edge function
- No direct Deepgram API calls from browser

### Technical notes
- Deepgram WebSocket URL: `wss://api.deepgram.com/v1/listen?model=nova-2&language=sv&smart_format=true&interim_results=true`
- MediaRecorder with 250ms `timeslice` for low-latency streaming
- The hook interface stays identical so GunnarChat voice mode works unchanged

