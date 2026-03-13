

## Plan: Fix IFC Import Pipeline for Building 01

### Root Cause Analysis

Building 01 (`e409df6f`) has a 19 MB IFC file. Three failures occurred simultaneously:

1. **`ifc-to-xkt` edge function**: Crashed with **"Memory limit exceeded"** during IFC parsing. The 19 MB file is just under the 20 MB browser-fallback threshold but too large for the edge function's memory limit.

2. **Browser fallback not triggered**: The error detection code checks for `WORKER_LIMIT`, `compute resources`, and status `546`, but **does not match "Memory limit exceeded"**. So the error is thrown as a fatal failure instead of triggering `runBrowserConversion()`.

3. **`ifc-extract-systems` (hierarchy population)**: Crashes because the WASM symlink approach fails — `Deno.mkdir` on the internal npm path is `NotSupported`, and unlike `ifc-to-xkt` which uses `Deno.readFileSync` monkey-patching, `ifc-extract-systems` uses the old symlink approach. The WASM file is never found at the expected path.

4. **Jobs stuck at "processing"**: Since the edge function crashes (not a graceful error), the job status never gets updated to "failed" or "done".

**Result**: XKT model files exist (from the browser conversion that DID run somehow, or a previous upload), but **no storeys or spaces** were created in the `assets` table.

---

### Fixes

#### 1. Fix `ifc-extract-systems` WASM loading (Critical)
The `ensureWasm()` function in `ifc-extract-systems/index.ts` uses the **symlink approach** (line 36-46), which fails because `Deno.mkdir` on the edge runtime internal path is `NotSupported`. The `ifc-to-xkt` function already has the correct fix: **monkey-patching `Deno.readFileSync`** to redirect WASM reads.

**Change**: Replace the symlink approach in `ifc-extract-systems/index.ts` with the same `Deno.readFileSync` monkey-patch used in `ifc-to-xkt/index.ts`.

#### 2. Broaden browser fallback detection in `CreateBuildingPanel.tsx`
Add "Memory limit exceeded" to the error strings that trigger browser-based fallback conversion.

**Change** in `CreateBuildingPanel.tsx` line ~361: Add `Memory limit` to the `isWorkerLimit` detection string check.

#### 3. Lower the direct-browser threshold
19 MB is clearly too large for the edge function. Lower the threshold from 20 MB to **10 MB** so files like this go straight to browser conversion.

**Change** in `CreateBuildingPanel.tsx` line 262: `const useDirectBrowser = fileSizeMB > 10;`

#### 4. Fix stuck conversion jobs
Reset the two stuck "processing" jobs for building 01 to "failed" so they don't block future attempts. This is a data fix via migration.

---

### Files to Change

1. **`supabase/functions/ifc-extract-systems/index.ts`** — Replace symlink WASM approach with `Deno.readFileSync` monkey-patch
2. **`src/components/settings/CreateBuildingPanel.tsx`** — Lower threshold to 10 MB, add "Memory limit" to fallback detection
3. **Database migration** — Reset stuck jobs to "failed"

