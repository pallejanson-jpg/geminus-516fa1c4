

# Fix: FM Access Routing in Geminus AI + Chat Scroll

## Problem
1. When user asks about FM Access, Geminus AI uses local Supabase tools (`get_building_summary`, `query_assets`) instead of FM Access API tools. The data returned (avvikelser, kanaldelar, floors) is local asset data, not FM Access data.
2. FM Access has drawings, documents, and DoU — but there's no `fm_access_get_documents` tool for live API queries (only `search_fm_access_local` for cached data).
3. Chat history can't be scrolled back due to missing `min-h-0` on ScrollArea.

## Changes

### 1. Add `fm_access_get_documents` tool (`supabase/functions/gunnar-chat/index.ts`)

Add a new tool definition (after `fm_access_get_floors` ~line 365):
```
fm_access_get_documents — "Get documents (DoU, technical docs) from FM Access for a building."
  params: fm_access_building_guid (required)
```

Add execution function `execFmAccessGetDocuments` that calls `callFmAccessQuery("get-documents", { buildingId })` and returns document list with name, fileName, className.

Wire it in `executeTool` switch.

### 2. Strengthen FM Access routing in system prompt (~line 1491)

Replace the single FM Access line with a prominent block:

```
CRITICAL — FM ACCESS QUERIES:
When user asks about "FM Access", "ritningar", "dokument i FM Access", "DoU", or references FM Access data:
→ NEVER use get_building_summary, query_assets, or aggregate_assets — those query LOCAL Geminus data, not FM Access.
→ First call query_building_settings to get fm_access_building_guid.
→ Then use fm_access_get_drawings, fm_access_get_documents, fm_access_get_hierarchy, fm_access_get_floors, or fm_access_search_objects for LIVE data.
→ Use search_fm_access_local only for fast cached searches of synced FM Access data.
→ If fm_access_building_guid is null/missing, tell user: "Den här byggnaden har ingen FM Access-koppling konfigurerad."
→ All other building data (assets, work orders, issues, sensors) comes from Geminus backend — use normal tools for those.
```

### 3. Fix chat scroll (`src/components/chat/GunnarChat.tsx`)

- Line 843: `flex-1 p-4` → `flex-1 min-h-0 p-4`
- Line 980: `flex-1 p-3` → `flex-1 min-h-0 p-3`

