

## Two Changes: Gunnar Performance + English Language Consistency

### 1. Gunnar — Speed Optimization and "Ge mig rad" Button

**Problem A: Gunnar is too slow**

The primary model is `google/gemini-2.5-pro` which is the most expensive and slowest model. Combined with up to 7 tool-calling rounds (each a separate API call), a single query can take 30-60 seconds. The proactive insights fetch on mount adds further delay.

**Fix:**
- Switch primary model from `google/gemini-2.5-pro` to `google/gemini-2.5-flash` (3-5x faster, still strong reasoning)
- Keep `google/gemini-2.5-flash-lite` as fallback (instead of flash)
- Reduce `MAX_TOOL_ROUNDS` from 7 to 4 (most queries resolve in 1-2 rounds)
- Add a timeout on the streaming response (client-side) with an abort controller

**Problem B: "Ge mig rad" button showing the prompt text**

The button currently sends a long Swedish prompt visible in the chat. The button itself should remain but the prompt text should not be displayed in the UI as a user message. Instead it should be sent as a hidden system-level instruction.

**Fix:**
- Hide the advisor prompt from the chat message list: when the advisor button is clicked, send a special flag (`advisor: true`) to the edge function instead of injecting the prompt as a visible user message
- The edge function will detect `advisor: true` and inject the advisor instructions internally
- The user sees only a clean "Analyzing..." state, not the raw prompt

**Problem C: Red toast / error**

Likely caused by the pro model timing out or returning a 500 error. The fallback logic exists but may not handle all edge cases. The switch to flash will largely eliminate this.

### 2. English Language Consistency

**Problem:** Many UI strings are in Swedish. Per the localization strategy, all system text must be in English while data values (room names, etc.) remain in their source language.

**Scope of changes** (files with Swedish UI text to convert to English):

| File | Swedish text to change |
|---|---|
| `src/components/chat/GunnarChat.tsx` | "Hej!", greetings, "Tanker...", "Fraga om dina fastigheter...", "Enter for att skicka", "Aktuell status", "Ge mig rad" |
| `src/pages/Properties.tsx` | "Fastigheter", "Hantera din fastighetsportfolj", "Sok fastigheter...", "Lagg till fastighet", status labels (Aktiv, Underhall, Vantande), type labels, dropdown items |
| `src/pages/Dashboard.tsx` | Stats titles, "Senaste aktivitet", "Snabbatgarder", button labels |
| `src/components/layout/AppSidebar.tsx` | "Fastigheter", "3D-visning" navigation labels |
| `src/components/fault-report/*.tsx` | "Felanmalan skickad!", toast messages, button labels |
| `src/components/viewer/CreateIssueDialog.tsx` | Issue type labels, placeholder text, submit button |
| `src/components/ai-scan/DetectionReviewQueue.tsx` | "Vantande", "Godkanda", "Avvisade", "Stang" |
| `src/components/settings/SymbolSettings.tsx` | "Redigera", "Ny annotationssymbol" |
| `src/components/settings/RoomLabelSettings.tsx` | "Redigera" buttons |
| `src/components/viewer/AssetPropertiesDialog.tsx` | "Redigera" button |
| `src/components/layout/RightSidebar.tsx` | Help articles content, "Tryck Enter..." |
| `src/pages/AutodeskCallback.tsx` | "Inloggning lyckades!" |
| `src/components/settings/ProfileModal.tsx` | "Profil", "AI-assistenter", "Stang" |
| `supabase/functions/gunnar-chat/index.ts` | Proactive insight messages ("oppna arenden", "arbetsordrar"), system prompt Swedish examples, action button labels |

**Important:** The term "Properties" refers to the page/section name and must never be translated — it stays as "Properties" in English.

### Technical Detail

**File: `supabase/functions/gunnar-chat/index.ts`**
- Change `AI_MODEL_PRIMARY` from `google/gemini-2.5-pro` to `google/gemini-2.5-flash`
- Change `AI_MODEL_FALLBACK` to `google/gemini-2.5-flash-lite`
- Change `MAX_TOOL_ROUNDS` from 7 to 4
- Translate proactive insight strings to English
- Update system prompt guideline #1 to: "Always respond in English unless the user explicitly writes in another language"
- Translate action button labels and example text to English
- Add advisor mode handling: detect `advisor: true` flag and inject advisor prompt internally

**File: `src/components/chat/GunnarChat.tsx`**
- Translate all greeting strings to English
- Change "Tanker..." to "Thinking..."
- Change placeholder to "Ask about your properties..."
- Change "Enter for att skicka" to "Enter to send"
- Change "Aktuell status" to "Current status"
- Change "Ge mig rad" button: instead of sending visible message, send `{ messages, context, advisor: true }`
- Show "Analyzing your building..." while advisor mode is loading
- Add AbortController with 60s timeout on fetch calls

**File: `src/pages/Properties.tsx`**
- "Fastigheter" -> "Properties"
- "Hantera din fastighetsportfolj" -> "Manage your property portfolio"
- "Sok fastigheter..." -> "Search properties..."
- "Lagg till fastighet" -> "Add property"
- Status: "Aktiv" -> "Active", "Underhall" -> "Maintenance", "Vantande" -> "Pending"
- Dropdown: "Visa detaljer" -> "View details", "Redigera" -> "Edit", etc.

**File: `src/pages/Dashboard.tsx`**
- Translate all stat titles, descriptions, activity labels, and button text to English

**File: `src/components/layout/AppSidebar.tsx`**
- "Fastigheter" -> "Properties"
- "3D-visning" -> "3D Viewer"

**All other files listed above** — systematic translation of button labels, toast messages, placeholder text, and status labels from Swedish to English.

