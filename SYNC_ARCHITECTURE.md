# Geminus — Sync Architecture & Local Node.js Migration

---

## 1. How the sync works today

```
Your Browser (React)
      │
      │  supabase.functions.invoke("asset-plus-sync", { action: "..." })
      ▼
Supabase Edge Functions  (Deno, runs in Supabase cloud)
      │                  └─ asset-plus-sync/index.ts     ← main sync engine
      │                  └─ acc-sync/index.ts             ← Autodesk ACC
      │                  └─ fm-access-sync/index.ts       ← FM Access docs
      │                  └─ acc-to-assetplus/index.ts     ← bidirectional
      │
      ├──► Asset+ API  (Keycloak OAuth → PublishDataServiceGetMerged)
      ├──► Autodesk ACC API  (3-legged OAuth)
      ├──► FM Access API
      │
      ▼
Supabase PostgreSQL  (project: diqfthpfncdojlnqnicq)
      └─ assets                  ← all buildings / floors / rooms / instances
      └─ asset_sync_state        ← running/completed/interrupted status per subtree
      └─ asset_sync_progress     ← step-by-step progress log
      └─ geometry_entity_map     ← BIM object ↔ Asset+ guid cross-reference
      └─ building_settings       ← per-building API credential overrides
      └─ api_profiles            ← named credential profiles
      └─ asset_plus_endpoint_cache  ← 24h cache of working 3D base URL
```

### The five sync actions in `asset-plus-sync`

| Action | What it does |
|--------|-------------|
| `check-delta` | COUNT local vs remote, return discrepancy numbers |
| `sync-structure` | Pull buildings (type 1), storeys (2), spaces (3) |
| `sync-assets-resumable` | Pull instances (type 4) in batches of 200, cursor-based, resumes on timeout |
| `push-missing-to-assetplus` | Push local-only assets (`is_local = true`) back up to Asset+ |
| `sync-xkt-resumable` | Download XKT 3D model files per building |

### How resumable sync works
The Edge Function has a **60-second wall-clock limit** (Supabase cap). For large datasets it:
1. Fetches a batch (200 records, or 25 if MongoDB sort memory limit hit)
2. Upserts to Supabase in chunks of 100
3. If it hits ~50 seconds, returns `{ interrupted: true, totalSynced: N }`
4. The frontend React loop sees `interrupted`, waits 2 seconds, calls again
5. The next call picks up from a cursor (`fmGuid > lastGuid`), avoiding high-skip timeouts

---

## 2. Do you have Supabase access from local Node.js?

**YES — and you already have the credentials in `.env`:**

```
SUPABASE_URL=https://diqfthpfncdojlnqnicq.supabase.co
SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ...  (anon key)
```

What the **anon key** can do right now:
- ✅ READ `assets` (public read policy was just added in last migration)
- ✅ READ `asset_sync_state`, `asset_sync_progress`
- ✅ INVOKE any Edge Function (most have `verify_jwt = false` in config.toml)
- ❌ WRITE to `assets` directly (RLS blocks anon writes)
- ❌ Read `building_settings` / `api_profiles` (those rows are protected)

What you need the **service_role key** for:
- Direct INSERT/UPDATE/DELETE on any table bypassing RLS
- Reading `building_settings`, `api_profiles`, `user_roles`

> The `service_role` key is NOT in your `.env` file — it's a secret stored in Supabase's
> project settings. Get it from: https://supabase.com/dashboard/project/diqfthpfncdojlnqnicq/settings/api

---

## 3. The Lovable → Local Node.js transition

Lovable only hosted the **React frontend**. It did NOT host the sync intelligence — that lives in:

| Where | What | Status |
|-------|------|--------|
| `supabase/functions/` | All sync logic (Deno Edge Functions) | ✅ Already in your codebase, deployed to Supabase cloud |
| `src/services/` | Frontend service wrappers | ✅ In your codebase |
| `supabase/migrations/` | Full database schema | ✅ In your codebase |
| Supabase PostgreSQL | All synced data | ✅ Running in cloud, accessible via anon key |

**The sync engine is already independent of Lovable.** When you trigger a sync in the UI, it calls Supabase Edge Functions — those run in Supabase's cloud, not Lovable's servers.

---

## 4. Three paths for the local Node.js app

### Path A — Invoke existing Edge Functions (quickest)
Your Node.js app calls the same Edge Functions the React app does.
No rewriting needed.

```js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://diqfthpfncdojlnqnicq.supabase.co',
  process.env.SUPABASE_ANON_KEY   // or service_role key for write access
);

// Trigger a sync
const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
  body: { action: 'sync-structure', force: true }
});

// Read assets directly from DB
const { data: assets } = await supabase
  .from('assets')
  .select('*')
  .eq('category', 'Building');
```

**Pros:** Works immediately. All 50+ edge functions available.  
**Cons:** Still dependent on Supabase cloud execution. 60s timeout per call still applies.

---

### Path B — Port sync logic to Node.js (full independence)
Rewrite the Deno Edge Functions as Node.js modules.

Key things to port:
- `supabase/functions/_shared/credentials.ts` → Node.js credential resolver
- `supabase/functions/asset-plus-sync/index.ts` → Node.js sync service
- Replace `Deno.env.get(...)` with `process.env...`
- Replace Deno HTTP with `node-fetch` or native `fetch` (Node 18+)

```
src/
  sync/
    asset-plus/
      credentials.js      ← ported from _shared/credentials.ts
      sync-structure.js   ← ported from asset-plus-sync actions
      sync-assets.js
      fetch-objects.js    ← fetchAssetPlusObjects + fetchWithAdaptiveRetry
    acc/
      sync.js             ← ported from acc-sync/index.ts
```

**Pros:** No 60s timeout. Full control. Can run on a schedule (cron). No Supabase compute costs.  
**Cons:** More work to port. Must manage credentials locally.

---

### Path C — Hybrid (recommended)
Keep Edge Functions for complex multi-step ops (XKT sync, OAuth flows), but add a Node.js layer for:
- Scheduled sync jobs (cron)
- Direct Supabase DB reads for your UI
- Lightweight queries that don't need a full Edge Function

---

## 5. Credentials you need to gather

To run sync from Node.js you need:

| Key | Where to get it |
|-----|----------------|
| `SUPABASE_URL` | Already in `.env` |
| `SUPABASE_ANON_KEY` | Already in `.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Settings → API |
| `ASSET_PLUS_API_URL` | Currently in Supabase Edge Function env vars |
| `ASSET_PLUS_KEYCLOAK_URL` | Same |
| `ASSET_PLUS_CLIENT_ID` | Same |
| `ASSET_PLUS_USERNAME/PASSWORD` | Same |

Get the Edge Function env vars from:  
https://supabase.com/dashboard/project/diqfthpfncdojlnqnicq/settings/functions

---

## 6. Immediate next steps

1. **Get service_role key** from Supabase dashboard and add to `.env` as `SUPABASE_SERVICE_ROLE_KEY`
2. **Test connection** — run the Node.js snippet from Path A against your live DB
3. **Decide: Path A or B** — if you need scheduled/automated sync with no timeout limits, go Path B
4. **Export Edge Function secrets** — copy the Asset+ credentials from Supabase's function env vars to your local `.env`

---

## 7. Security note (important)

`config.toml` shows `verify_jwt = false` on **virtually every** Edge Function.  
This means anyone with your Supabase URL can call them — no auth token needed.  
When moving to local Node.js, this is convenient (no auth headers required), but once you re-enable real auth, these functions should be locked down.
