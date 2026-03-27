

## Plan: Rebuild Geminus AI as Structured BIM Viewer Controller

### Overview

Refactor the existing Gunnar chat backend and frontend to operate as a **structured, tool-driven AI assistant** that returns machine-readable JSON actions instead of free-text markdown. The AI selects the right RPC-style tool, fetches data, resolves viewer entity IDs via `geometry_entity_map`, and returns a structured response that the frontend uses to directly control the xeokit viewer.

### What exists today

- **Backend** (`supabase/functions/gunnar-chat/index.ts`): 1800-line edge function with ~30 tools, inline Supabase queries, markdown-based action links, streaming SSE responses.
- **Frontend** (`src/components/chat/GunnarChat.tsx`): 1100-line component parsing markdown action links (`action:flyTo:guid`) and dispatching `CustomEvent`s to the viewer.
- **Viewer bridge**: `GUNNAR_HIGHLIGHT`, `GUNNAR_SHOW_FLOOR`, `GUNNAR_FLY_TO` events handled in `AssetPlusViewer.tsx`.
- **Entity mapping**: `geometry_entity_map` table maps `asset_fm_guid` → `external_entity_id` (xeokit entity IDs).

### Changes

#### 1. Create 5 RPC functions in database

Create Postgres functions (via migration) that the edge function calls through `supabase.rpc()`:

| RPC Function | Purpose |
|---|---|
| `get_assets_by_system(system_query text)` | Query assets by system/asset_type (ventilation, el, etc.) |
| `get_assets_in_room(room_guid text)` | All assets in a specific room |
| `get_assets_by_category(cat text)` | Assets filtered by category |
| `search_assets_rpc(search text)` | Free-text search on name/common_name/asset_type |
| `get_viewer_entities(asset_ids text[])` | Given asset fm_guids, return external_entity_ids from geometry_entity_map |

All functions return JSON, limit to 200 rows, and use `SECURITY DEFINER` with `search_path = public`.

#### 2. Rewrite edge function tool definitions

Replace the current ~30 ad-hoc tools with 5 clean tools matching the RPC functions above. Each tool:
- Accepts parameters matching the RPC signature
- Calls `supabase.rpc()` instead of inline queries
- Returns raw structured JSON (no UI formatting)

Keep existing utility tools that are still needed: `resolve_building_by_name`, `list_buildings`, `get_building_summary`. Remove or consolidate the rest.

Add a mandatory post-processing step: when the AI's tool results contain `asset_ids` and the user intent involves visualization, the system auto-calls `get_viewer_entities` to resolve `external_entity_ids`.

#### 3. Change AI response format

Instead of streaming markdown with embedded `action:` links, the AI returns a structured JSON response:

```json
{
  "message": "Found 12 ventilation units on floor 2",
  "action": "highlight",
  "asset_ids": ["guid1", "guid2"],
  "external_entity_ids": ["entityId1", "entityId2"],
  "filters": {
    "system": "ventilation",
    "category": "",
    "room": ""
  }
}
```

The edge function will extract this from the AI's final tool call (using a `format_response` tool with the required schema) and return it as JSON (not SSE stream).

#### 4. Update system prompt

Rewrite `buildSystemPrompt` to enforce:
- Always use tools, never guess
- For visualization requests, always chain `get_viewer_entities` after data fetch
- Return structured format via `format_response` tool
- Never hallucinate system names
- Keep responses minimal
- If no results, return empty arrays

#### 5. Rewrite frontend action handler

In `GunnarChat.tsx`, replace the markdown action-link parser with a structured response handler:

```typescript
// Parse JSON response
const response = JSON.parse(data);

// Display message in chat
addMessage({ role: 'assistant', content: response.message });

// Execute viewer action
if (response.external_entity_ids?.length > 0) {
  switch (response.action) {
    case 'highlight':
      highlightEntities(response.external_entity_ids);
      break;
    case 'filter':
      filterToEntities(response.external_entity_ids);
      break;
    case 'list':
      // Just show the message, no viewer action
      break;
  }
}
```

#### 6. Implement viewer integration functions

Add two functions to `NativeViewerShell.tsx` (or a new hook `useAiViewerBridge.ts`):

- **`highlightEntities(entityIds: string[])`**: Color/flash the specified entities, ghost all others
- **`resetView()`**: Remove all highlighting, restore default visibility

These listen for a new `AI_VIEWER_COMMAND` event dispatched by the chat component.

#### 7. Keep existing features intact

- Voice input/output (unchanged)
- Conversation memory (unchanged)
- Building context resolution (keep `resolve_building_by_name`)
- Proactive insights mode (keep as-is)
- Simple intent fast-path (keep)

### File changes summary

| File | Action |
|---|---|
| `supabase/migrations/` | New migration: 5 RPC functions |
| `supabase/functions/gunnar-chat/index.ts` | Rewrite tools to use RPC, add `format_response` tool, change response format from SSE to JSON |
| `src/components/chat/GunnarChat.tsx` | Replace markdown action parsing with structured JSON handler |
| `src/hooks/useAiViewerBridge.ts` | New hook: `highlightEntities()`, `resetView()` |
| `src/components/viewer/NativeViewerShell.tsx` | Wire up `AI_VIEWER_COMMAND` event listener using the new hook |

### Performance rules enforced

- All filtering done server-side via RPC (Postgres)
- Max 200 rows per query (enforced in RPC functions)
- No client-side asset loops
- Entity resolution via indexed `geometry_entity_map` table

