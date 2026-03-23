# Plan: Push ACC/IFC Objects to Asset+ with Model Revision Support

## Summary

Enable the standard Asset+ sync flow to include ACC/IFC-sourced objects (currently ~77,500 blocked items). All objects regardless of source should be synced to Asset+, with buildings created automatically if missing, and all instances linked to a model revision.

## Problem

1. `isNonAssetPlusGuid()` filter in `asset-plus-sync` rejects any `fm_guid` starting with `acc-bim-` or `acc-`
2. `push-missing-to-assetplus` only pushes objects whose `building_fm_guid` exists in Asset+ — ACC buildings don't
3. Model-sourced objects (`createdInModel=true`) must be linked to a model revision in Asset+, which doesn't exist yet for ACC/IFC imports

## Steps

### 1. Database migration — extend `acc_assetplus_guid_map`

Add columns:
- `model_id UUID` — Asset+ model ID for this building
- `revision_id UUID` — Asset+ revision ID

### 2. Extend `sync-structure` in `asset-plus-sync/index.ts`

After pulling remote structure, add a phase:
- Query local buildings with `fm_guid LIKE 'acc-%'` or IFC-sourced buildings (have `xkt_models` entries)
- For each, check `acc_assetplus_guid_map` for existing mapping
- If unmapped: create Complex → Building → Model → Revision in Asset+ via `AddObjectList` + `CreateRevision`
- Store all GUID mappings (complex, building, model, revision)

### 3. Remove `isNonAssetPlusGuid` filter

In `push-missing-to-assetplus` and `sync-with-cleanup` actions:
- Remove the `acc-` prefix rejection
- Add GUID translation: look up `acc_assetplus_guid_map` to swap local ACC GUIDs with Asset+ GUIDs
- Translate `building_fm_guid`, `level_fm_guid`, `in_room_fm_guid` through the map

### 4. Model revision linkage

When pushing instances for ACC/IFC buildings:
- Look up `model_id` and `revision_id` from the guid map
- Include model context in `AddObjectList` payload so Asset+ links objects to the correct revision

### 5. Update `check-delta` to include ACC objects

Remove the ACC exclusion filter so delta comparisons reflect the full dataset.

## Files to modify

1. **Migration** — add `model_id`, `revision_id` to `acc_assetplus_guid_map`
2. **`supabase/functions/asset-plus-sync/index.ts`** — new helpers (`ensureAccBuildingInAssetPlus`, `translateGuid`), remove ACC filters, add model revision logic

## Flow diagram

```text
Current:
  sync-structure → pull remote → push local (SKIP acc-*)

New:
  sync-structure → pull remote
                 → detect ACC/IFC buildings missing from Asset+
                 → create Complex → Building → Model → Revision
                 → store GUID mappings
  push-missing   → include ALL objects (translate GUIDs via map)
                 → link instances to model revision
```

## Constraints

- Asset+ requires `UpsertRelationships` objects to share the same model revision
- `externalType` must be a valid IFC type (e.g. `IfcAlarm`)
- Edge function ~50s timeout — use existing resumable loop pattern
- FM GUIDs must be preserved (not regenerated)
