

## Plan: Backend-only IFC-to-XKT conversion (IMPLEMENTED)

### Changes made

1. **`conversion_jobs` table** — Created with RLS (users see own jobs), realtime enabled for polling.
2. **`supabase/functions/ifc-to-xkt/index.ts`** — Fixed WASM path (`https://unpkg.com/web-ifc@0.0.57/`), added progress tracking to `conversion_jobs` table, improved error logging with `err?.message || String(err)`.
3. **`src/components/settings/CreateBuildingPanel.tsx`** — Removed all client-side conversion. All files (any size) upload to storage → create `conversion_jobs` row → invoke edge function → poll for progress via 2s interval.
4. **`src/services/ifc-worker-bridge.ts`** — Deleted (no longer needed).
5. **`src/services/acc-xkt-converter.ts`** — IFC branch now throws error directing to server-side path.
