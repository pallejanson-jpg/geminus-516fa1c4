

# PWA + iPhone Action Button via Siri Shortcut

## Summary

Since Geminus is already a PWA (manifest.json, service worker, apple-mobile-web-app meta tags are in place), the only change needed is to support a **deep-link URL that opens Gunnar in voice mode**. The user can then create a Siri Shortcut that opens this URL and assign it to iPhone's Action Button.

## What to build

1. **Voice-mode deep link**: Add query parameter support (`?gunnar=voice`) to the app entry point. When detected, auto-open Gunnar with voice mode activated.

2. **Instructions page/toast**: On first PWA install or in Settings, show a brief guide: "To use the Action Button: Settings → Action Button → Shortcut → Open URL → paste `https://gemini-spark-glow.lovable.app/?gunnar=voice`"

## Technical changes

### `src/components/layout/AppLayout.tsx`
- On mount, check `URLSearchParams` for `gunnar=voice`
- If present, dispatch events to show Gunnar button and auto-open chat in voice mode
- Remove the param from URL after processing (via `replaceState`)

### `src/components/chat/GunnarButton.tsx`
- Listen for a custom event `GUNNAR_AUTO_OPEN_VOICE` 
- When received, open the chat panel and activate the microphone toggle automatically

### `src/components/chat/GunnarChat.tsx`
- Accept an `autoVoice` prop
- When true, auto-enable voice mode on mount (call `start()` from `useWebSpeechRecognition`)

### No native code needed
The PWA is already installable. The user configures iPhone Action Button → Shortcuts → "Open URL" manually.

## Files to edit
- `src/components/layout/AppLayout.tsx` — URL param detection
- `src/components/chat/GunnarButton.tsx` — auto-open listener  
- `src/components/chat/GunnarChat.tsx` — auto-voice prop

