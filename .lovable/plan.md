

# Plan: Fix Geminus AI Chat Stability & Quality for Demo

## Problems Identified

1. **Crash on action button click**: The AI generates action links like `action:search_help_docs:...` which are NOT in the `KNOWN_ACTIONS` set. `stripRawActionTokens` only strips `[action:...]` bracket format but NOT markdown links with unknown actions. When the button IS rendered (because it passes through `markdownComponents`), clicking it falls through the `handleActionLink` switch with no matching case, potentially causing errors. The real crash likely comes from the AI generating malformed action links or links with action types that don't have handlers.

2. **Raw action tokens visible**: The AI sometimes outputs bare `action:` text without proper markdown syntax, or uses action types not in `KNOWN_ACTIONS` — these render as plain text showing ugly internal tokens.

3. **`search_help_docs` action leaking**: The system prompt example shows `(action:search_help_docs:...)` but this is NOT a valid client action — it's a server-side tool name. The AI confuses tool names with action tokens.

## Changes

### 1. `src/components/chat/GunnarChat.tsx` — Harden action handling

- **Expand `stripRawActionTokens`** to also strip markdown-style action links with unknown action types (e.g., `[label](action:search_help_docs:...)` → just show "label" as plain text)
- **Add a `default` case in `handleActionLink`** switch that shows a toast instead of silently failing or crashing
- **Ensure unknown actions in `markdownComponents`** render as plain `<span>` (already done) — but also catch any edge cases where the action format doesn't match the regex

### 2. `supabase/functions/gunnar-chat/index.ts` — Fix system prompt

- **Remove the example** that shows `search_help_docs` as an action link — it's a TOOL, not a client action. The AI is confusing tools with action tokens.
- **Strengthen the instruction** to never generate action tokens for tool names
- **Add explicit rule**: "NEVER use tool names (like search_help_docs, list_buildings, query_assets) as action tokens. Action tokens are ONLY for client-side UI navigation."

### 3. Additional robustness in `GunnarChat.tsx`

- Wrap `handleActionLink` dispatch in try/catch so any unexpected error shows a toast rather than crashing
- Add `search_help_docs` and any other leaked tool names to a blocklist that gets stripped from responses

## Technical Details

**File: `src/components/chat/GunnarChat.tsx`**
- `stripRawActionTokens` (~line 80): Enhance regex to also catch `[text](action:unknownType:...)` and convert to plain text
- `handleActionLink` (~line 688): Add default case with `toast.info("This action is not available here")`
- `markdownComponents` (~line 787): Already filters unknown actions to `<span>`, verify this is working

**File: `supabase/functions/gunnar-chat/index.ts`**
- System prompt (~line 1546): Strengthen rule 11 and add a new rule explicitly forbidding tool names as action tokens
- Remove/fix the confusing example at line 1562 that mixes tool names with action syntax

