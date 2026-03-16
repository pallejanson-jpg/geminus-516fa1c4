

# Fix: Geminus AI Misrouting FM Access Questions

## Problem
When user asks "Kan du svara på frågor om FM Access?", the AI responds with alarm/asset data from the local Geminus database instead of either (a) answering the capability question directly, or (b) using FM Access tools. The system prompt already has FM Access routing rules (lines 1590-1596) but the AI model ignores them.

## Root Cause
Two issues:
1. **Previous conversation contamination**: The `previousConversation` context (lines 1518-1524) injects the last 4 messages from the previous session. If those were about alarms, the AI may continue that thread instead of answering the new question.
2. **Prompt priority**: The FM Access routing rules are buried deep in the system prompt (line 1590). The AI model may not weight them strongly enough, especially when conversation history pulls attention elsewhere.

## Fix (in `supabase/functions/gunnar-chat/index.ts`)

### 1. Add FM Access capability question to fast-path intent detector
Extend `detectSimpleIntent` to catch "kan du svara på frågor om fm access" as a "help_fm_access" intent, returning a direct capability answer without entering the tool loop. This prevents the AI from misrouting a simple capability question.

### 2. Move FM Access routing rules higher in the system prompt
Move the "CRITICAL — FM ACCESS QUERIES" block from line 1590 to right after "CORE RULES" (after line 1541) to increase its priority weight in the prompt.

### 3. Add explicit negative instruction to the FM Access block
Add: "If the user asks WHETHER you can answer FM Access questions (e.g. 'kan du svara på frågor om fm access?'), answer YES and explain your FM Access capabilities — do NOT run any data queries."

## Files to Edit
- `supabase/functions/gunnar-chat/index.ts`

