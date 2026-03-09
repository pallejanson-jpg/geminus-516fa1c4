

## Plan: External Conversion Worker API + Worker Script + Viewer Tile Loading

### Summary

This plan implements the remaining pieces for true per-storey XKT tiling:

1. **A new edge function** (`conversion-worker-api`) that an external worker can poll for jobs and report results
2. **A standalone Node.js worker script** (in `docs/`) that does the actual IFC → per-storey XKT splitting
3. **Viewer updates** to load per-storey XKT tiles instead of the monolithic file when chunks with separate `storage_path` values exist
4. **Frontend queue UI** refinements so `CreateBuildingPanel` can show "Queued → Processing → Ready" for worker-processed jobs

### What We Can Build in Lovable

- The **edge function API** the worker talks to (job polling, progress updates, completion)
- The **worker source code** as a standalone script in `docs/conversion-worker/worker.mjs` (you deploy it yourself on Fly.io / Railway / any VPS with 4-8GB RAM)
- The **viewer logic** to detect real tile chunks (different `storage_path` per chunk) and load them individually
- The **frontend polling UI** for queue-based status

### What You Deploy Yourself

- The Node.js worker process on a server with sufficient RAM. We provide the script + Dockerfile + instructions.

---

### Changes

#### 1. New Edge Function: `supabase/functions/conversion-worker-api/index.ts`

A lightweight API the external worker calls with a shared secret:

- **`GET /pending`** — Returns the oldest `pending` conversion job
- **`POST /claim`** — Worker claims a job (sets status to `processing`)
- **`POST /progress`** — Worker reports progress (percent, log messages)
- **`POST /complete`** — Worker uploads results: marks job `done`, creates `xkt_models` records for each tile
- **`POST /fail`** — Worker reports failure

Auth: Uses a `WORKER_API_SECRET` shared secret (not user JWT).

#### 2. Config: `supabase/config.toml`

Add `verify_jwt = false` for the new function.

#### 3. Worker Script: `docs/conversion-worker/worker.mjs`

A standalone Node.js script that:
- Polls `conversion-worker-api` for pending jobs every 10s
- Downloads IFC from Supabase Storage via signed URL
- Streams to disk, runs `convert2xkt` per storey (grouping by IfcBuildingStorey)
- Uploads per-storey `.xkt` files + `metadata.json` back to storage
- Reports completion with tile manifest

Includes `docs/conversion-worker/Dockerfile` and `docs/conversion-worker/README.md`.

#### 4. Update `conversion_jobs` table — Add RLS for service-role updates

Currently users can't UPDATE conversion_jobs. The edge function uses service role, so this works. No migration needed.

#### 5. Viewer: Load Real Tile Chunks

Update `NativeXeokitViewer.tsx` model loading logic:
- When fetching `xkt_models`, check if `is_chunk = true` entries exist with **different** `storage_path` values (not virtual chunks pointing to same file)
- If real tiles exist: load only tiles for the active floor + adjacent floors
- Listen for floor-change events to load/unload tiles dynamically
- Fall back to monolithic loading if no real tiles exist (current behavior)

#### 6. Update `useFloorPriorityLoading.ts`

Add a `isRealTile` check: if chunks have unique `storage_path` values, use dynamic tile loading instead of visibility filtering.

### Files to Create/Change

| File | Action |
|------|--------|
| `supabase/functions/conversion-worker-api/index.ts` | Create — worker API |
| `supabase/config.toml` | Add verify_jwt entry |
| `docs/conversion-worker/worker.mjs` | Create — Node.js worker script |
| `docs/conversion-worker/Dockerfile` | Create — Docker setup |
| `docs/conversion-worker/README.md` | Create — deployment guide |
| `src/components/viewer/NativeXeokitViewer.tsx` | Update — tile-aware loading |
| `src/hooks/useFloorPriorityLoading.ts` | Update — real vs virtual chunk detection |

### Architecture After Changes

```text
IFC Upload → Supabase Storage
       ↓
  conversion_jobs (status: 'pending')
       ↓
  External Worker (polls conversion-worker-api)
    - Downloads IFC via streaming
    - Groups objects by IfcBuildingStorey
    - Generates per-storey .xkt tiles
    - Uploads tiles to storage
    - Reports completion → xkt_models records created
       ↓
  Viewer detects real tiles (unique storage_paths)
    - Loads active floor tile (~15MB)
    - Lazy-loads adjacent floors
    - Skips monolithic 120MB load
```

