

# Plan: Congeria Document Sync Fix + Ilean Native UI + Translations

## Summary

Three workstreams: (1) fix why Congeria documents never arrive, (2) replace the Ilean iframe with a native Geminus UI that calls Senslinc APIs directly (like SenslincDashboardView does for sensor data), and (3) translate all Swedish strings to English.

---

## 1. Fix Congeria Document Sync

**Root cause**: The `documents` table has no unique constraint on `(building_fm_guid, file_path)`, so the `onConflict` in upsert silently fails. Additionally, the scraper only requests `formats: ['links']` but Congeria is a JS-rendered SPA where document URLs may not appear in the raw links array.

**Changes:**

- **Database migration**: Add unique constraint `UNIQUE(building_fm_guid, file_path)` on `documents` table
- **Edge function `congeria-sync`**: Change scrape formats to `['links', 'html']` and improve `parseDocumentLinks` to also scan the HTML content for download hrefs (not just the links array). Add a `test-scrape` diagnostic action that returns raw scrape results for debugging
- **Translate** all Swedish strings in `congeria-sync` and `DocumentsView` to English

## 2. Replace Ilean Iframe with Native UI

**Current state**: `IleanButton` opens a draggable panel with an `<iframe src={senslincPortalUrl}/ilean/>`. This has issues: cross-origin restrictions, authentication problems, and the user explicitly does not want iframing.

**New approach** (matching the SenslincDashboardView pattern):

- **New edge function action** `get-ilean-data` in `senslinc-query`: Call the Senslinc API to fetch whatever Ilean provides for a given site/line/machine. This likely includes the Ilean chat endpoint or contextual data. We'll probe `/api/sites/{pk}/ilean/` or similar API endpoints.
- **New hook `useIleanData`**: Similar to `useSenslincData`, calls the backend function and returns structured Ilean data (contextual insights, recommendations, chat responses).
- **Rewrite `IleanButton`**: Remove the iframe entirely. Replace with a native floating panel that:
  - Shows the contextual entity (building/floor/room) with the same header as today
  - Displays Ilean insights/chat natively using Geminus UI components (cards, charts, text)
  - Uses the Senslinc API for data, rendered in our own React components
  - Keeps the draggable trigger button behavior
  - If Ilean exposes a chat API, implement a chat interface similar to `GunnarChat`
  - If Ilean only provides a web page (no API), add a "Open in Senslinc" button that links out, and show contextual sensor data from the existing `useSenslincData` hook instead

**Key technical question**: We need to discover whether Senslinc exposes Ilean as an API endpoint (e.g., `/api/ilean/chat/`) or only as a web page. The edge function will probe this and we'll adapt accordingly.

## 3. Translate All Swedish UI to English

Files to translate:
- `src/components/portfolio/DocumentsView.tsx` — all labels, toasts, empty states
- `src/components/chat/IleanButton.tsx` — tooltips, loading text, headers
- `src/components/viewer/SenslincDashboardView.tsx` — labels, tab names, status text
- `supabase/functions/congeria-sync/index.ts` — error messages
- `supabase/functions/senslinc-query/index.ts` — Swedish error messages (lines 309, 322, etc.)

## 4. Gunnar + Documents

No code changes needed for Gunnar. The `query_documents` tool in `gunnar-chat` already queries the `documents` table. Once the sync fix populates documents, Gunnar will automatically be able to answer questions about them.

---

## Implementation Order

1. Database migration (unique constraint)
2. Fix `congeria-sync` edge function (HTML parsing + diagnostics)
3. Add `get-ilean-data` action to `senslinc-query` (probe Ilean API)
4. Create `useIleanData` hook
5. Rewrite `IleanButton` with native UI (no iframe)
6. Translate all Swedish strings to English across all affected files

