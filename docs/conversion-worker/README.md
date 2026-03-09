# XKT Conversion Worker

External Node.js worker that polls for pending IFC conversion jobs, splits models by `IfcBuildingStorey`, converts each to a separate `.xkt` tile, and uploads results back to storage.

## Architecture

```
IFC Upload → Supabase Storage → conversion_jobs (pending)
                                       ↓
                              This worker polls API
                                       ↓
                              Download IFC → Parse → Split by storey
                                       ↓
                              Per-storey .xkt tiles → Upload to storage
                                       ↓
                              xkt_models records created → Viewer loads tiles
```

## Requirements

- Node.js 18+
- 4–8 GB RAM (for large IFC files)
- Network access to your Supabase project

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `WORKER_API_SECRET` | Yes | Shared secret (must match edge function) |
| `POLL_INTERVAL_MS` | No | Poll interval in ms (default: 10000) |

## Setup

### 1. Set the worker API secret

Add `WORKER_API_SECRET` to your Supabase project secrets (same value the worker uses).

### 2. Run locally

```bash
cd docs/conversion-worker
npm init -y
npm install @xeokit/xeokit-convert@1.3.1 web-ifc@0.0.57

SUPABASE_URL=https://your-project.supabase.co \
WORKER_API_SECRET=your-secret-here \
node worker.mjs
```

### 3. Deploy with Docker

```bash
cd docs/conversion-worker
docker build -t xkt-worker .
docker run -d \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e WORKER_API_SECRET=your-secret-here \
  --name xkt-worker \
  xkt-worker
```

### 4. Deploy to Fly.io

```bash
fly launch --name xkt-worker --no-deploy
fly secrets set SUPABASE_URL=https://your-project.supabase.co
fly secrets set WORKER_API_SECRET=your-secret-here
fly deploy
```

### 5. Deploy to Railway

1. Create new project from Dockerfile
2. Set environment variables
3. Deploy

## How It Works

1. Worker polls `conversion-worker-api/pending` every 10s
2. Claims a job → status becomes `processing`
3. Downloads IFC from signed URL
4. Parses with `web-ifc`, finds `IfcBuildingStorey` elements
5. Converts each storey to `.xkt` using `@xeokit/xeokit-convert`
6. Uploads tiles to `xkt-models` storage bucket
7. Reports completion → `xkt_models` records created
8. Viewer detects per-storey tiles and loads them dynamically

## Result

Instead of loading one 120 MB `.xkt` file, the viewer loads ~15 MB per storey, with adjacent floors lazy-loaded in the background.
