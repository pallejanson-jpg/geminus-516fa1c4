

# Gunnar 2.0 -- Intelligent Property Assistant

## Problem Today

Gunnar has three major limitations:

1. **Limited data access** -- Can only query the `assets` table via a custom SQL parser. Misses `work_orders`, `bcf_issues`, `building_settings`, and cross-table queries.
2. **No real memory** -- Each response is isolated; the AI cannot build on previous questions intelligently.
3. **Static follow-ups** -- The AI must manually write JSON blocks for suggested next steps, which rarely works well.

## Solution: AI Tool Calling

Replace the custom SQL parser with tool calling -- let the AI model decide which data it needs by invoking predefined functions.

```text
User -> GunnarChat (frontend) -> gunnar-chat edge function -> Lovable AI Gateway
                                       |
                                       v
                                 Tool calls:
                                 - query_assets(filters, limit)
                                 - query_work_orders(filters)
                                 - query_issues(filters)
                                 - get_building_summary(fm_guid)
                                 - search_assets(search_term)
```

**Flow:**
1. User types a question
2. AI receives full conversation history + context (active building, view, etc.)
3. AI decides which tools to call
4. Edge function executes the tools against the database
5. Results are sent back to the AI, which formulates a natural response with smart follow-up suggestions

## What This Enables

- **Understands all questions** -- AI interprets natural language and picks the right data sources
- **Cross-table queries** -- "Are there open issues in this building?" works out of the box
- **Smart follow-ups** -- AI suggests next steps based on the conversation, not hardcoded
- **Deeper data** -- Access to work orders, issues, building settings, not just assets

## Technical Changes

### 1. Edge function: `supabase/functions/gunnar-chat/index.ts` (rewrite)

- Define 5 tools the AI can invoke:
  - `query_assets` -- Filter assets by category, building, level, room, asset_type. Returns count or list.
  - `query_work_orders` -- Filter work orders by status, building, priority.
  - `query_issues` -- Filter BCF issues by status, building.
  - `get_building_summary` -- Get overview for a building: floors, rooms, assets, area, open issues.
  - `search_assets` -- Free-text search in common_name/name/asset_type.

- First AI call sent with `tools` and `tool_choice: "auto"`
- If AI returns tool calls: execute them against the database, collect results, make a second streaming call with results
- If AI responds directly (no tool call needed): stream the response directly

- Updated system prompt: shorter, focused on tool usage, instructs AI to always suggest 2-3 follow-up questions as plain text

### 2. Frontend: `src/components/chat/GunnarChat.tsx` (update)

- **Markdown rendering** -- Switch from `<pre>` to `react-markdown` for formatted responses with headings, lists, bold
- **Improved follow-ups** -- Parse follow-up questions from the AI response (numbered list at end) and display as clickable buttons
- **Auto-send follow-ups** -- When user clicks a follow-up, send it directly instead of just filling the input field
- **Remove SQL/JSON parsing** -- `parseResponse` and `extractSqlQuery` no longer needed on frontend

### 3. New dependency: `react-markdown`

Added for rendering AI responses with formatting.

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/gunnar-chat/index.ts` | Rewrite: replace SQL parsing with tool calling (5 tools) |
| `src/components/chat/GunnarChat.tsx` | Update: markdown rendering, better follow-ups, remove JSON parsing |
| `package.json` | Add `react-markdown` |

## What Does NOT Change

- Streaming logic (SSE) -- already works well
- Action system (selectInTree, flyTo, etc.) -- kept but triggered via tool calls instead
- GunnarContext interface -- same context sent from frontend
- Authentication -- same auth flow

