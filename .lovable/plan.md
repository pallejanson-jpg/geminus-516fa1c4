

# Plan: Backend-only IFC-to-XKT conversion

## Problem

IFC conversion currently splits between client-side (<20MB) and server-side (>20MB). Both paths have issues:
- **Client-side**: Freezes or crashes the browser for large files. 250MB+ files are common in production.
- **Server-side**: The edge function crashes because `web-ifc` WASM fails to initialize in Deno (`wasmPath: ""` does not resolve).

All conversion should happen server-side. The frontend should only upload the file and poll for status.

## Constraint: Edge function memory

Deno edge functions have ~150MB memory. A 250MB IFC file cannot be held in memory alongside the parsed model and output XKT. Two strategies:

1. **For files up to ~80MB IFC**: Fix WASM initialization and process in the edge function directly.
2. **For larger files**: Use **streaming upload + background job pattern** — the edge function kicks off conversion in smaller steps, writing progress to a `conversion_jobs` table. The frontend polls this table for status.

Since true streaming parsing of IFC is not supported by `web-ifc`, the realistic approach for 250MB+ files is to use `IfcAPI` with explicit WASM initialization and process synchronously but with proper WASM loading.

## Changes

### 1. Fix edge function WASM initialization (`supabase/functions/ifc-to-xkt/index.ts`)

The root cause is `wasmPath: ""`. In Deno, `web-ifc` needs explicit WASM initialization:

```typescript
const ifcApi = new WebIFC.IfcAPI();
// Set WASM path to npm package location (Deno resolves this)
ifcApi.SetWasmPath("https://unpkg.com/web-ifc@0.0.57/");
await ifcApi.Init();
```

Then use `ifcApi` directly instead of relying on `parseIFCIntoXKTModel`'s internal WASM handling. Parse geometry element-by-element and build XKT manually.

Also fix error logging: `err?.message || String(err)`.

### 2. Add conversion job tracking (new migration)

Create a `conversion_jobs` table so the frontend can poll progress:

```sql
CREATE TABLE conversion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid text NOT NULL,
  ifc_storage_path text NOT NULL,
  model_name text,
  status text NOT NULL DEFAULT 'pending',  -- pending, processing, done, error
  progress integer DEFAULT 0,
  log_messages text[] DEFAULT '{}',
  result_model_id text,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

ALTER TABLE conversion_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own jobs" ON conversion_jobs
  FOR SELECT TO authenticated USING (created_by = auth.uid());
CREATE POLICY "Users can create jobs" ON conversion_jobs
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
```

### 3. Simplify frontend (`CreateBuildingPanel.tsx`)

Remove all client-side conversion code:
- Remove `convertToXktWithMetadata` import and `ifc-worker-bridge` dependency
- Remove `SERVER_CONVERSION_THRESHOLD` — all files go server-side
- Upload IFC to storage → create a `conversion_jobs` row → call edge function → poll `conversion_jobs` for status updates
- Show progress from the `conversion_jobs.progress` and `log_messages` columns
- Remove the `ifc-worker-bridge.ts` service (no longer needed)

### 4. Update edge function to write progress to DB

The edge function updates `conversion_jobs` as it progresses:
- `status: 'processing'`, `progress: 10` — downloading IFC
- `progress: 30` — WASM initialized, parsing
- `progress: 70` — XKT generated
- `progress: 90` — uploaded to storage
- `status: 'done'`, `progress: 100` — complete

### 5. Remove client-side conversion code

Delete `src/services/ifc-worker-bridge.ts` — no longer needed since all conversion is backend.

## Files

| File | Action |
|------|--------|
| Migration SQL | Create `conversion_jobs` table |
| `supabase/functions/ifc-to-xkt/index.ts` | Fix WASM init, write progress to DB |
| `src/components/settings/CreateBuildingPanel.tsx` | Remove client-side conversion, poll `conversion_jobs` |
| `src/services/ifc-worker-bridge.ts` | Delete |

