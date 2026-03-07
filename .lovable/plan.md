

## Plan: Document Pre-indexing, Help Docs URL Settings, Gunnar UX Improvements

### Part 1: `document_chunks` Table + Pre-indexing Pipeline

**New DB table** `document_chunks`:
```sql
CREATE TABLE public.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL DEFAULT 'document', -- 'document', 'help_doc'
  source_id text,
  building_fm_guid text,
  file_name text,
  chunk_index integer NOT NULL DEFAULT 0,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON public.document_chunks FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Service write" ON public.document_chunks FOR ALL USING (true) WITH CHECK (true);
```

**New DB table** `help_doc_sources` (for the Settings UI):
```sql
CREATE TABLE public.help_doc_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name text NOT NULL,
  url text NOT NULL,
  last_indexed_at timestamptz,
  chunk_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.help_doc_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage" ON public.help_doc_sources FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Auth read" ON public.help_doc_sources FOR SELECT USING (auth.uid() IS NOT NULL);
```

**New edge function** `index-documents/index.ts`:
- Action `index-building-docs`: Downloads PDFs from storage for a building, sends to Gemini for text extraction, chunks into ~2000 chars, upserts to `document_chunks`.
- Action `index-help-docs`: For each row in `help_doc_sources`, uses Firecrawl (already connected) to scrape the URL as markdown, chunks the content, stores as `source_type='help_doc'`.
- Action `index-single-url`: Scrapes one URL and indexes it.

**Update `gunnar-chat/index.ts`**:
- Replace `ask_about_documents` implementation to query `document_chunks` via `ilike` text search instead of on-demand PDF parsing.
- Add `search_help_docs` tool that queries `document_chunks WHERE source_type='help_doc'` to answer platform usage questions.

### Part 2: Settings UI for Help Doc URLs

**New section in `ApiSettingsModal.tsx`** under a suitable tab (e.g., "AI" tab alongside Gunnar/Ilean):
- Title: "Knowledge Base Sources"
- Table listing `help_doc_sources` rows (app name, URL, last indexed, chunk count)
- "Add URL" form: app name + URL input
- "Index All" button: calls `index-documents` with action `index-help-docs`
- "Index" button per row: indexes a single URL
- "Delete" button per row

### Part 3: Gunnar UX — No GUIDs, Clickable Choices

**Problem:** Gunnar shows raw fm_guids to users and requires them to type building names to disambiguate.

**Fix in `gunnar-chat/index.ts` system prompt:**
Add these rules:
```
CRITICAL UX RULES:
1. NEVER show fm_guid, building_fm_guid, or any UUID to the user. These are internal IDs.
2. When disambiguating between buildings, ALWAYS present them as clickable action buttons, never as text the user needs to type.
3. Format building choices as:
   - [🏢 Småviken 1](action:openViewer:FM_GUID)
   - [🏢 Huvudbyggnad](action:openViewer:FM_GUID)
   NOT as "HK (fm_guid: dd737f81-...)"
4. When asking the user to choose, use numbered action buttons:
   "Vilken byggnad menar du?"
   1. [🏢 Småviken 1](action:openViewer:GUID1) — Labradorgatan 16
   2. [🏢 Huvudbyggnad](action:openViewer:GUID2) — Storgatan 5
5. Always include address or other identifying info alongside building names — NOT GUIDs.
6. For follow-up suggestions, format as clickable buttons when possible.
```

**Fix in `GunnarChat.tsx`:**
Add a new action type `selectBuilding` that sets the building context for the conversation without navigating:
```typescript
case "selectBuilding":
  // Update the chat's building context so subsequent queries scope to this building
  executeAction({ action: "selectBuilding", buildingFmGuid: parts[1], buildingName: parts[2] });
  break;
```
In `executeAction`, handle `selectBuilding` by sending a follow-up message to Gunnar with the selected building context, e.g., auto-send "Jag menar [building name]" so the conversation continues naturally.

Also add a `chooseBuilding` action type for disambiguation — renders as larger, card-style buttons in the chat.

### Part 4: Gunnar in Support Pages

**Update system prompt** to include comprehensive help text for all platform features when `activeApp === 'support'` or when `search_help_docs` is called. The indexed help docs from Part 1 will serve this purpose.

**Update `GunnarChat.tsx` context** to pass `activeApp: 'support'` when on support pages, and add a support-specific greeting.

---

### Files Modified/Created

- **New migration** — `document_chunks` + `help_doc_sources` tables
- **New** — `supabase/functions/index-documents/index.ts`
- **Modified** — `supabase/functions/gunnar-chat/index.ts` (new tools, UX prompt rules)
- **Modified** — `src/components/chat/GunnarChat.tsx` (new action types: `selectBuilding`)
- **Modified** — `src/components/settings/ApiSettingsModal.tsx` (Knowledge Base Sources UI)

