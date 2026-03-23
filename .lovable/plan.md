

# Analysis & Updated Plan

## User Questions Answered

### "Can we not use the XKT worker for Asset+ buildings like Småviken?"
Correct. The XKT worker pipeline (IFC→XKT conversion with per-storey splitting) only applies to IFC-uploaded buildings. Asset+ buildings like Småviken have pre-built XKT files served from the Asset+ 3D API — they are downloaded whole and cached in storage. The per-storey binary splitting done by the worker is not available for these models.

### "Can we just fetch the A-model and lazy-load the rest?"
Yes — and this is **already implemented** in NativeXeokitViewer (lines 631-641). It splits models into A-models and secondary, loads A-models first, and defers secondary models. However, **the overhead before that split is the problem**: it queries ALL models from DB, lists ALL files in storage, and batch-checks metadata files for ALL models. These parallel fetches add latency even though only the A-model will be loaded initially.

### "Akerselva: the model is called ARK-modell in Asset+, shouldn't starts-with-A work?"
Yes. The DB data confirms `parentCommonName = "ARK-modell"` for the storey with `parentBimObjectId = bc185635...`. The name resolution in NativeXeokitViewer **does** resolve this (line 378: model_name gets updated from GUID to "ARK-modell"). So `isArchitectural("ARK-modell")` returns true (starts with "A"). This should already work correctly for model prioritization.

However, in `xkt_models` table, the `model_name` column still stores the raw GUID `bc185635...` — not "ARK-modell". The resolution only happens in-memory during viewer init. **Fix**: persist the resolved name back to `xkt_models` so future loads don't need the resolution step.

### "Is the 'Modell 2' the Orphan model from Asset+?"
Looking at the DB: Akerselva has two models — `bc185635...` (8.6 MB, no name → resolved to "ARK-modell") and `0e687ea4...` (9.2 MB, named "Modell 2"). There's no storey data linking to `0e687ea4...` (only `bc185635...` appears in parentBimObjectId). So yes, "Modell 2" is likely the Orphan model from Asset+ — it has no storey associations and was given a generic name.

## Proposed Changes

### 1. Fix Level Filtering (Småviken still broken)
**Root cause**: The current approach (lines 229-284) tries to match storey `fmGuid` values against xeokit metaObject IDs from A-models. This fails because Asset+ storey GUIDs (e.g. `38591717-...`) are different from xeokit entity IDs.

**Fix**: Use `parentCommonName` (already available as `storey.sourceName`) directly. Filter storeys where `isArchitecturalModel(sourceName)` returns true. Fallback to all if none match.

**File**: `src/components/viewer/ViewerFilterPanel.tsx`
- Replace `aModelMetaObjectIds` memo (lines 229-257) and the level filter (lines 264-284) with:
```typescript
const levels = useMemo(() => {
  // Filter to A-model storeys using parentCommonName from DB
  const filtered = storeyAssets.filter((storey) => {
    if (!storey.sourceName || isGuid(storey.sourceName)) return false;
    return isArchitecturalModel(storey.sourceName);
  });
  // Fallback: if no A-model storeys found, show all
  const result = filtered.length > 0 ? filtered : storeyAssets;
  return result.map(...).sort(...); // existing mapping/sorting
}, [storeyAssets, ...]);
```
- Remove `aModelMetaObjectIds` memo entirely.

### 2. Optimize Viewer Init for A-Model-Only Loading
**File**: `src/components/viewer/NativeXeokitViewer.tsx`
- After resolving model names (line 385), **skip the storage listing** (lines 336-360) for models that already have DB records. The storage listing is redundant when DB data exists.
- Move the metadata file batch-check (lines 678-692) to only check files for models in the `loadList` (A-models), not all models.
- Persist resolved model names back to `xkt_models` so Akerselva's "ARK-modell" is cached for next time.

### 3. Optimize Preload Hook
**File**: `src/hooks/useXktPreload.ts`
- Already only preloads A-models (correct behavior). No changes needed.

## Technical Details

- `parentCommonName` values in DB: "A-modell" (Småviken), "ARK-modell" (Akerselva), "B-modell", "E-modell", "V-modell"
- `isArchitecturalModel()` checks: starts with "A", contains "ARKITEKT", excludes NON_ARCH_PREFIXES
- Both "A-modell" and "ARK-modell" pass this check correctly
- The `sourceName` field in `storeyAssets` maps directly to `attrs.parentCommonName` (line 213)

