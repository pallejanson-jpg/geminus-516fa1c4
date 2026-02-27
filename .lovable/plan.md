

# Plan: Transform Ilean into a Document Q&A Chat via Senslinc API

## Understanding

Ilean in Senslinc is a **document Q&A feature** — users ask questions about documents stored in Senslinc, and Ilean answers. The current implementation incorrectly shows IoT sensor gauges. Instead, Ilean should be a **chat interface** (like Gunnar) that proxies questions to Senslinc's Ilean API and renders responses in Geminus UI.

**Role separation:**
- **Gunnar** = Geminus data + Senslinc IoT data
- **Ilean** = Document Q&A via Senslinc Ilean API

## Technical Discovery Needed

The Senslinc edge function currently constructs URLs like `/site/{pk}/ilean/` (a web page). We need to discover if Senslinc exposes an Ilean **API endpoint** (e.g., `/api/sites/{pk}/ilean/ask/` or similar REST/chat endpoint). This will be done by adding a probe action to the edge function.

## Implementation Steps

### 1. Add `ilean-ask` action to `senslinc-query` edge function
- New action that: (a) resolves the site/line/machine PK from fmGuid, (b) POSTs the user's question to Senslinc's Ilean API endpoint (likely `/api/sites/{pk}/ilean/` or `/api/ilean/ask/`), (c) returns the answer
- Add a `ilean-probe` diagnostic action that tries known Ilean API patterns and returns what's available
- If no chat API exists, fall back to using a Lovable AI model (Gemini) with Senslinc document context as a proxy

### 2. Rewrite `useIleanData` hook → `useIleanChat` hook
- Replace the sensor-data-fetching hook with a chat-oriented hook
- Manages conversation messages (user/assistant)
- `sendMessage(question: string)` → calls `senslinc-query` with `ilean-ask` action
- Maintains context (building/floor/room PK) for scoping questions
- Returns `{ messages, sendMessage, isLoading, contextEntity }`

### 3. Rewrite `IleanButton` panel as a chat UI
- Remove all sensor gauge/chart components (MiniGauge, MiniChart)
- Replace with a chat interface matching the GunnarChat pattern:
  - Message list with markdown rendering (ReactMarkdown)
  - Text input + send button
  - Context header showing current building/floor/room
  - Suggested starter questions (e.g., "What documents are available?", "Summarize maintenance reports")
- Keep the existing draggable trigger button and panel drag/minimize behavior
- Keep the "Open in Senslinc" external link button

### 4. Update edge function interface type
- Add `'ilean-ask' | 'ilean-probe'` to the `SenslincRequest.action` union
- Add `question?: string` and `conversationHistory?: Array<{role: string, content: string}>` to the request interface

### Files to modify
- `supabase/functions/senslinc-query/index.ts` — add `ilean-ask` and `ilean-probe` actions
- `src/hooks/useIleanData.ts` — rewrite as chat hook (rename to useIleanChat or keep name)
- `src/components/chat/IleanButton.tsx` — replace sensor UI with chat UI

