

# IFC-to-XKT Conversion Architecture

## Implementation (Completed)

### Dual-path conversion strategy

| File size | Path | Details |
|-----------|------|---------|
| ≤ 20 MB | **Client-side** (main thread) | `convertToXktWithMetadata()` via dynamic imports. Acceptable UI blocking for small files. |
| > 20 MB | **Server-side** (edge function) | IFC uploaded to `ifc-uploads` bucket → `ifc-to-xkt` edge function converts → XKT stored in `xkt-models` bucket. UI stays responsive. |

### Components

- **`supabase/functions/ifc-to-xkt/index.ts`** — Edge function using `npm:web-ifc` + `npm:@xeokit/xeokit-convert`. Downloads IFC from storage, converts, uploads XKT, saves metadata.
- **`src/components/settings/CreateBuildingPanel.tsx`** — Routes files based on size threshold. Shows Cloud/Monitor icon to indicate conversion mode.
- **`src/services/ifc-worker-bridge.ts`** — Main-thread fallback using dynamic imports (Web Worker approach abandoned due to Node.js module incompatibility with Vite bundling).

### Storage buckets

- `ifc-uploads` (private) — Raw IFC files for server-side conversion
- `xkt-models` (private) — Converted XKT files

### Fragments 2.0 evaluation

Using Fragments 2.0 only for IFC parsing is **not possible** — it outputs `.frag` (Flatbuffers for Three.js), not `.xkt`. A full viewer migration to Three.js would be a multi-week effort. The server-side approach keeps the existing xeokit stack untouched.
