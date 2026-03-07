

## Plan: Faciliate REST API Integration + GeminusPluginMenu Fix

### Context from Uploaded Documents

The Faciliate API (by Service Works Global / SWG) is a REST API with:
- **Auth**: JWT login via `POST /api/v2/login` (username + password → JWT token)
- **CRUD**: `GET /api/v2/<object>` (read with filter/sort/take/skip), `PUT /api/v2/<object>/<guid>` (update), `POST /api/v2/<object>` (create)
- **Swagger**: Available at `GET /api/v2/system/swagger` for discovering available objects
- **Filtering**: Supports simple (`ID eq "1234"`) and advanced JSON-based filtering with AND/OR/IN operators
- **Load levels**: `guid`, `basic`, `simple`, `fullprimary`, `loadmax`

SWG secrets (`SWG_SUPPORT_URL`, `SWG_SUPPORT_USERNAME`, `SWG_SUPPORT_PASSWORD`) are already configured — the existing `support-proxy` edge function already authenticates against this same SWG platform for support cases.

### Part 1: Fix GeminusPluginMenu Not Showing in FMA+

**File:** `src/components/viewer/FmaInternalView.tsx`
- Line 112: Change condition from `{!isLoading && !loadError && buildingFmGuid && (` to `{!isLoading && !loadError && (`
- The plugin menu already handles undefined `buildingFmGuid` gracefully
- Ensure FAB z-index (z-40) sits above the iframe

### Part 2: Faciliate API Proxy Edge Function

Create `supabase/functions/faciliate-proxy/index.ts` — a general-purpose proxy to the Faciliate REST API, reusing the SWG credentials already configured.

**Actions:**
- `login` — Authenticate and cache JWT
- `list` — `GET /api/v2/<object>?take=&skip=&filter=&sort=&loadlevel=`
- `get` — `GET /api/v2/<object>/<guid>`
- `create` — `POST /api/v2/<object>`
- `update` — `PUT /api/v2/<object>/<guid>`
- `swagger` — `GET /api/v2/system/swagger` (discover available objects)

Uses the same `SWG_SUPPORT_URL` / `SWG_SUPPORT_USERNAME` / `SWG_SUPPORT_PASSWORD` secrets. Auth pattern mirrors `support-proxy` (JWT caching, auto-login on 401).

### Part 3: Faciliate Data in Geminus

Once the proxy exists, Faciliate data (work orders, buildings, customers, spaces) becomes available to:

1. **Gunnar AI** — Add a `query_faciliate` tool in `gunnar-chat/index.ts` so Gunnar can search work orders, buildings, and other Faciliate objects via natural language
2. **Sidebar integration** — A new "Faciliate" section or option under existing views to browse Faciliate objects within Geminus
3. **Plugin route** — The `/plugin` route already works for external embedding; Faciliate's PC app can open this URL in an embedded browser (CEF) with context parameters

### Part 4: Plugin URL for Publishing

No code changes needed. The published URL for external embedding:

```
https://gemini-spark-glow.lovable.app/plugin?building=<GUID>&floor=<GUID>&room=<GUID>&source=faciliate
```

### Files Modified/Created

| File | Action |
|------|--------|
| `src/components/viewer/FmaInternalView.tsx` | Fix: remove `buildingFmGuid` condition for plugin menu |
| `supabase/functions/faciliate-proxy/index.ts` | New: general Faciliate REST API proxy |
| `supabase/config.toml` | Add faciliate-proxy function config |
| `supabase/functions/gunnar-chat/index.ts` | Add `query_faciliate` tool definition + execution |
| `docs/api/README.md` | Add Faciliate to integrated systems table |

### Secrets

No new secrets needed — reuses existing `SWG_SUPPORT_URL`, `SWG_SUPPORT_USERNAME`, `SWG_SUPPORT_PASSWORD`.

