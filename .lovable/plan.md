

# Plan: Transform Ilean into a Document Q&A Chat via Senslinc API

## Status: ✅ Implemented

## What was done

### 1. Edge function (`senslinc-query`)
- Added `ilean-ask` action: resolves site PK from fmGuid, tries multiple Senslinc Ilean API endpoints (e.g. `/api/sites/{pk}/ilean/ask/`), falls back to Lovable AI (Gemini) with building context
- Added `ilean-probe` diagnostic action: probes known Ilean API patterns and returns results
- Updated `SenslincRequest` interface with `question` and `conversationHistory` fields

### 2. Hook (`useIleanData`)
- Rewritten as a chat-oriented hook managing `messages`, `sendMessage()`, `clearMessages()`
- Still resolves building/floor/room context from viewer events
- Returns `{ messages, sendMessage, clearMessages, isLoading, contextEntity, contextLevel }`

### 3. UI (`IleanButton`)
- Removed all sensor gauge/chart components (MiniGauge, MiniChart, Recharts)
- Replaced with a GunnarChat-style chat interface: markdown message list, text input, send button
- Starter questions for empty state
- Context header showing building/floor/room
- Clear conversation button
- Kept draggable trigger button, minimize, and "Open in Senslinc" behavior

### Role separation
- **Gunnar** = Geminus data + Senslinc IoT data
- **Ilean** = Document Q&A via Senslinc Ilean API (with Lovable AI fallback)
