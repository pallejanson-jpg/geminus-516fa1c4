

## Plan: Röst-/Språkinställningar + Interaktiva Svarsknappar i Geminus AI

### Tre delar

#### 1. Settings: Språk & Röstval (`GunnarSettings.tsx`)

Lägg till `speechLang` och `voiceName` i `GunnarSettingsData`. Ny Accordion-sektion "Speech & Language":
- **Språk**: Select med `sv-SE` / `en-US` (default: `sv-SE`)
- **Röst**: Select populerad via `speechSynthesis.getVoices()`, filtrerad på valt språk. "System default" som fallback.

Byt rubrik från "Gunnar" → "Geminus AI".

#### 2. Röststyrning via chat: AI-tool för språkbyte

Lägg till ett nytt tool i `gunnar-chat/index.ts`:

```text
change_speech_settings
  - speech_lang: "sv-SE" | "en-US"  
  - voice_name: string (optional)
```

Systempromten instrueras att vid frågor som "byt till engelska" eller "vilka röster finns?" returnera ett action-token (`action:changeLang:en-US` / `action:listVoices`) som klienten fångar och agerar på.

I `GunnarChat.tsx`:
- `speakAssistant` läser `speechLang` + `voiceName` från settings istället för hårdkodat `sv-SE`
- `useWebSpeechRecognition` får `language: speechLang`
- Ny `executeAction` case: `changeLang` → anropar `saveGunnarSettings({ speechLang })` och bekräftar
- Ny `executeAction` case: `listVoices` → hämtar `speechSynthesis.getVoices()`, visar som klickbara knappar

#### 3. Interaktiva svarsknappar (clickable options)

Uppdatera systempromten så att AI:n alltid använder action-buttons för val istället för att be användaren skriva. Redan delvis på plats (byggnadsval), men utökas till:
- Byggnadslista → klickbara knappar (finns redan)
- Våningslista → klickbara knappar  
- Alla flervals-frågor → numrerade klickbara knappar
- Röstval → klickbara knappar

I `GunnarChat.tsx` behövs ingen ny rendering — action-buttons fångas redan av `markdownComponents` som renderar `<a>` till `handleActionLink`. Systempromten får en ny instruktion:

> "When asking the user to choose between options, ALWAYS present each option as a clickable action button. Never ask the user to type a choice when a button can be used instead."

### Filer att ändra

| Fil | Ändring |
|-----|---------|
| `src/components/settings/GunnarSettings.tsx` | Byt namn till "Geminus AI", lägg till `speechLang` + `voiceName` i data + UI |
| `src/components/chat/GunnarChat.tsx` | Läs speech-settings, uppdatera `speakAssistant` + `useWebSpeechRecognition`, nya action-handlers (`changeLang`, `listVoices`, `selectVoice`) |
| `supabase/functions/gunnar-chat/index.ts` | Ny systemprompt-instruktion för klickbara val + språkbyte-kommandon via action tokens |

### Nya Action Tokens

```text
action:changeLang:<langCode>        → byter TTS + STT-språk
action:listVoices                   → visar tillgängliga röster som knappar  
action:selectVoice:<voiceName>      → väljer en specifik röst
```

