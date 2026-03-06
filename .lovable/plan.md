

## Analysis

### 1. IFC Import Error

The error is clear from logs:
```
path not found: readfile '/var/tmp/sb-compile-edge-runtime/node_modules/localhost/web-ifc/0.0.57/tmp/web-ifc-wasm/web-ifc-node.wasm'
```

The `ensureWasm()` function downloads WASM files to `/tmp/web-ifc-wasm/`, but `web-ifc` is looking for them at a completely different path (`/var/tmp/sb-compile-edge-runtime/node_modules/localhost/web-ifc/0.0.57/tmp/web-ifc-wasm/`). The `wasmPath` parameter passed to `parseIFCIntoXKTModel` isn't being respected by the underlying `web-ifc` module — it's resolving its own path internally.

This is a known issue with `web-ifc` in Deno edge runtimes: the library ignores the provided `wasmPath` and tries to load from its npm module path, which doesn't exist in the edge function sandbox.

**Fix:** Instead of relying on `wasmPath`, we need to either:
- Patch the WASM locator by copying the file to where `web-ifc` expects it (`/var/tmp/sb-compile-edge-runtime/node_modules/localhost/web-ifc/0.0.57/tmp/web-ifc-wasm/`)
- Or use the `web-ifc` `IfcAPI.SetWasmPath()` approach before parsing

### 2. Does IFC import handle systems and FMGUIDs?

Looking at the code (lines 438-507): **Yes, systems are already extracted during IFC import** via `extractSystemsAndConnections()` and persisted via `persistSystemsAndConnections()`. So when a new building is created with IFC import, systems ARE handled.

However, **FMGUID generation/write-back is NOT yet implemented** — that's the `enrich-guids` mode from the plan that hasn't been built yet.

---

## Plan

### Fix 1: WASM path resolution in `ifc-to-xkt`

Update `ensureWasm()` to also copy the WASM files to the path where `web-ifc` actually looks for them. The error path reveals the expected location: `/var/tmp/sb-compile-edge-runtime/node_modules/localhost/web-ifc/0.0.57/tmp/web-ifc-wasm/`. We should create that directory and copy files there as well, in addition to `/tmp/web-ifc-wasm/`.

Alternatively, a more robust approach: parse the error path pattern and preemptively write to it. Since the Deno edge runtime resolves npm modules to `/var/tmp/sb-compile-edge-runtime/node_modules/...`, we can detect that path and ensure files exist there.

### Fix 2: Apply same fix to `ifc-extract-systems`

The new edge function has the same `ensureWasm()` pattern and will hit the same error. Apply the identical fix.

### Summary of answers to user's questions:

1. **Does IFC import handle systems?** — Yes, the `ifc-to-xkt` function already extracts systems and connections from IFC metadata and persists them. This works when the import itself succeeds.

2. **Does it handle FMGUIDs?** — Not yet. The `enrich-guids` mode (generating FMGUIDs for objects that lack them and writing back to IFC) is planned but not implemented.

3. **Why did the import fail?** — The WASM runtime path resolution is broken. `web-ifc` ignores the provided `wasmPath` parameter and looks for `.wasm` files at its npm module path, which doesn't exist in the edge function sandbox.

