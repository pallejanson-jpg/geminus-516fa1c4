

# Plan: Properties Dialog Fix, Close Button & IFC Memory Issue

## Issue 1: Properties Dialog Format

The `NativeViewerShell` already uses `UniversalPropertiesDialog` — the same component used in Portfolio, Rooms, and Assets views. The dialog IS correct. However, there may be a mismatch because the `fmGuid` passed from context menu might be null for BIM objects not in the database, causing the dialog to show "No data found" or BIM fallback instead of the full property view.

**No code change needed for dialog type** — it's already the correct one. If specific objects aren't showing properties, it's because they lack database records (fmGuid is null).

## Issue 2: Close Button Visibility

The desktop `UniversalPropertiesDialog` (line 1231) has a small ghost X button (`variant="ghost" size="icon" className="h-7 w-7"`). The user wants a more prominent, clearly visible close button.

**Changes in `src/components/common/UniversalPropertiesDialog.tsx`**:
- Replace the ghost X button with a more prominent styled button (e.g., `variant="outline"` or add a visible border/background)
- Increase the size slightly and ensure contrast against the header background
- Also add an explicit X close button to the mobile Sheet header

## Issue 3: IFC Import Memory Limit (WORKER_LIMIT)

The logs show the function successfully downloads a 24.1 MB IFC file, prepares WASM, starts parsing, then hits "Memory limit exceeded". Edge Functions have a ~150MB memory limit. Parsing a 24 MB IFC with web-ifc + xeokit-convert in memory exceeds this.

**Root cause**: The `parseIFCIntoXKTModel` call loads the entire IFC geometry into memory, builds an XKT model, then writes it out — all within one function invocation. For large files this exceeds the edge function memory ceiling.

**Mitigation strategy — Chunked/streaming approach**:

This is a fundamental limitation of Edge Functions. Options:

1. **Reduce memory footprint** (incremental): After reading IFC from disk, null out the `ifcBytes` variable before parsing. Use `{ zip: false }` (already done). Skip `autoNormals` to save some memory.

2. **Split the pipeline** (recommended): Instead of doing everything in one invocation:
   - **Phase 1** (`ifc-to-xkt`): Only extract metadata (hierarchy, systems) — no geometry conversion. This already works via `ifc-extract-systems`.
   - **Phase 2**: Use client-side conversion (`acc-xkt-converter.ts` has `convertToXktWithMetadata`) for geometry, which runs in the browser with more memory available.

3. **Immediate fix**: Add explicit memory cleanup between stages, reduce the model size threshold for server-side conversion, and gracefully fall back to client-side conversion when the server function fails.

**Changes in `supabase/functions/ifc-to-xkt/index.ts`**:
- Null out `ifcBytes` immediately after writing to disk (line 396-398): set `ifcBytes` to undefined after `Deno.writeFile`
- After `parseIFCIntoXKTModel`, explicitly null out the `ifcData` variable
- These are minor optimizations; for 24MB+ files the real fix is client-side fallback

**Changes in `src/components/settings/CreateBuildingPanel.tsx`**:
- When server conversion fails with WORKER_LIMIT, automatically fall back to client-side conversion using `AccXktConverter.convertAndStore()`
- Show a log message: "Server conversion exceeded memory limit, falling back to browser-based conversion..."

### Files to modify

| File | Changes |
|------|---------|
| `src/components/common/UniversalPropertiesDialog.tsx` | Make close button more prominent and visible |
| `supabase/functions/ifc-to-xkt/index.ts` | Memory cleanup optimizations |
| `src/components/settings/CreateBuildingPanel.tsx` | Client-side fallback when server hits memory limit |

