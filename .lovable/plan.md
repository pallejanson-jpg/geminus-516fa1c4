

# Evaluation: That Open / Fragments 2.0 for IFC Parsing

## Current Situation

The Web Worker approach for IFC-to-XKT conversion was abandoned because `@xeokit/xeokit-convert` imports Node.js modules (`node:util`, `fs`, `path`) that Vite cannot bundle into a worker. The current fallback runs IFC parsing on the main thread, which blocks the UI for large files (200+ MB).

## What Fragments 2.0 Offers

The That Open Company ecosystem consists of:

| Package | Purpose |
|---------|---------|
| `@thatopen/fragments` | Core binary format (Flatbuffers-based) + IFC importer |
| `@thatopen/components` | Higher-level engine: scene, camera, IfcLoader, FragmentsManager |

Key technical details from the documentation:

1. **IFC parsing uses `web-ifc` under the hood** -- the same WASM library we already use. So the raw parsing speed would be identical.

2. **Built-in Web Worker support** -- The `FragmentsManager` initializes with a worker URL (`worker.mjs`) that handles the heavy conversion off the main thread. This is the exact capability we've been trying to build.

3. **Output format is `.frag` (Flatbuffers), not `.xkt`** -- This is the critical difference. Fragments are designed for Three.js rendering, not xeokit.

4. **Three.js based renderer** -- The entire Fragments 2.0 viewer stack is Three.js. Models are added to a `THREE.Scene`, not a xeokit `Viewer`.

## Compatibility Assessment

```text
Current stack:          Proposed stack:
┌──────────────┐        ┌──────────────┐
│  IFC file    │        │  IFC file    │
│      ↓       │        │      ↓       │
│  web-ifc     │        │  web-ifc     │  ← same library
│      ↓       │        │      ↓       │
│ xeokit-conv  │        │ IfcImporter  │
│      ↓       │        │      ↓       │
│  .xkt file   │        │  .frag file  │  ← different format
│      ↓       │        │      ↓       │
│ XKTLoader    │        │ FragmentsMgr │
│      ↓       │        │      ↓       │
│ xeokit Viewer│        │ Three.js     │  ← different renderer
└──────────────┘        └──────────────┘
```

## Verdict

**Using Fragments 2.0 only for IFC parsing (keeping xeokit for viewing) is not possible.** The library converts IFC → `.frag`, not IFC → `.xkt`. There is no way to extract an XKT from the Fragments pipeline.

**Using Fragments 2.0 as a full viewer replacement** would mean:
- Replacing the entire `NativeXeokitViewer` with a Three.js-based Fragments viewer
- Replacing `XKTLoaderPlugin` with `FragmentsManager`
- Re-implementing all xeokit-specific features (NavCube, SAO, FastNav, section planes, X-ray mode, entity coloring, picking)
- Replacing the `.xkt` storage format with `.frag` in the database and storage
- This is a multi-week migration

## Recommended Path Forward

The most practical fix for the IFC conversion hang is **server-side conversion via a backend function**. This approach:
- Moves the heavy `web-ifc` + `xeokit-convert` work to a server (Deno runtime in the edge function)
- Keeps the existing `.xkt` format and xeokit viewer untouched
- Eliminates the browser main-thread blocking entirely
- The IFC `ArrayBuffer` gets uploaded to file storage, the function converts it, and stores the `.xkt` result

### Implementation Steps

1. **Create a backend function `ifc-to-xkt`** that receives an IFC file from storage, runs `web-ifc` + `xeokit-convert` server-side, and writes the resulting `.xkt` back to storage.

2. **Update `CreateBuildingPanel`** to upload the raw IFC to storage first, then invoke the backend function, and poll for completion.

3. **Keep `ifc-worker-bridge.ts`** as a local fallback for small files (<20 MB) where main-thread blocking is tolerable.

