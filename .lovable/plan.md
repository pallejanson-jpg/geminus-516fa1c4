

# Plan: Improve Large IFC Conversion Reliability

## Problem
276 MB IFC files parsed client-side via web-ifc WASM appear "stuck" because:
1. No progress feedback from WASM parser
2. Timeout of ~7 min may be too short for very large files
3. Main thread can appear frozen

## Changes

### 1. Increase timeout for large files
In `src/services/acc-xkt-converter.ts`, change the timeout formula to be more generous for large files (e.g., 3s per MB instead of 1.5s, minimum 10 min).

### 2. Add heartbeat/elapsed timer in UI
In `src/components/settings/CreateBuildingPanel.tsx`, add a visible elapsed-time counter during conversion so the user knows it's still running. Show "Parsing IFC... elapsed: 2m 15s" with a pulsing indicator.

### 3. Add a Web Worker wrapper (optional, larger change)
Move `parseIFCIntoXKTModel` into a Web Worker so the main thread stays responsive during WASM parsing. This prevents the browser from appearing frozen.

## Files to modify
- `src/services/acc-xkt-converter.ts` — increase timeout, add logging
- `src/components/settings/CreateBuildingPanel.tsx` — add elapsed timer display during conversion

