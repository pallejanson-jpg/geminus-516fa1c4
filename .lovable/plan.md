
## Plan: Replace Heuristic XKT/Asset Matching with a Canonical Geometry Mapping Layer

## Short answer

Yes — the current separation of `xkt_models` and `assets` is not the real problem. That separation is fine.

The real problem is that the app is currently joining them with too many **fallbacks and guesses**:
- model name inference from `parentCommonName`
- file-name matching in `useModelNames`
- floor matching from mixed `commonName` / `designation` / generated `Plan N`
- entity matching via `originalSystemId` when source data is inconsistent

That is why model names, floors, filters, properties, and viewer selection keep drifting.

## What I found in the current code

### Today the linkage is fragile
- `useModelNames.ts` tries to match XKT models to Asset+ names by:
  - `parentBimObjectId -> parentCommonName`
  - file-name discipline matching
  - API fallback
- `useModelData.ts` and `ViewerFilterPanel.tsx` derive model/source names from storey attributes
- `useFloorData.ts` falls back to generated names like `Plan 1`
- `AppContext.tsx` creates `Unnamed floor N` when storey names are incomplete
- Viewer selection/highlighting relies heavily on `metaObject.originalSystemId`

This means the UI is not driven by one authoritative mapping source.

## Recommended architecture

Do **not** merge geometry into the asset table.

Instead, keep:
- `assets` = business objects / hierarchy / editable properties
- `xkt_models` = geometry files / model storage
- add one authoritative **geometry mapping layer** between them

## New target design

```text
assets (authoritative business object)
   ^
   | 1:1 / 1:many canonical links
   |
geometry_entity_map (new or expanded mapping table)
   |
   +-- source_system       (asset_plus / ifc / acc)
   +-- building_fm_guid
   +-- asset_fm_guid
   +-- model_id
   +-- storey_fm_guid
   +-- external_entity_id  (GlobalId / originalSystemId / ACC externalId)
   +-- entity_type         (building/storey/space/instance)
   +-- source_model_guid
   +-- source_model_name
   +-- source_storey_name
   +-- last_seen_at
   +-- metadata jsonb
   |
   v
xkt_models (geometry binaries / chunks / manifests)
```

## Best implementation path

### 1. Introduce a canonical mapping table
Add a new table such as `geometry_entity_map` instead of continuing to overload runtime logic.

Why a new table instead of only `asset_external_ids`:
- `asset_external_ids` is too thin for the full runtime problem
- we need model-level and storey-level linkage, not just `fm_guid <-> external_id`
- we need to support floor filtering, model naming, selection, and property lookup from the same source

Suggested fields:
- `id`
- `building_fm_guid`
- `asset_fm_guid`
- `source_system`
- `external_entity_id`
- `entity_type`
- `model_id`
- `storey_fm_guid`
- `source_model_guid`
- `source_model_name`
- `source_storey_name`
- `metadata jsonb`
- `last_seen_at`

Unique key:
- `(source_system, building_fm_guid, external_entity_id, model_id)`

RLS:
- read for authenticated users
- write only via backend/service role

### 2. Populate it in every ingestion flow
#### Asset+ sync
When syncing Building / Storey / Space / Instance:
- write mapping rows for each object
- persist `parentBimObjectId`, `parentCommonName`, storey/building relationships as structured mapping data instead of relying on UI heuristics later

#### IFC import
In `ifc-to-xkt`:
- persist each metaObject’s IFC `GlobalId` / `originalSystemId`
- map storeys/spaces/instances directly to `asset_fm_guid`
- persist model/storey identity at import time

#### ACC pipeline
For ACC/glTF/XKT paths:
- persist external IDs from geometry manifest / index
- map them to `asset_fm_guid` once, server-side

## 3. Refactor the viewer/UI to use the mapping table as the single source of truth
Replace heuristic runtime matching in:
- `useModelNames.ts`
- `useModelData.ts`
- `useFloorData.ts`
- `ViewerFilterPanel.tsx`
- viewer selection/highlight lookup

New runtime rules:
- model identity comes from mapping records, not file names
- floor identity comes from `storey_fm_guid`, not display names
- entity selection comes from `external_entity_id -> asset_fm_guid`
- names are only labels, never join keys

## 4. Stop generating semantic fallback names except as pure UI placeholders
Keep placeholder names only for display when absolutely necessary, but never use them for matching:
- `Plan N`
- `Unnamed floor N`

All matching should use:
- `asset_fm_guid`
- `storey_fm_guid`
- `model_id`
- `external_entity_id`

## 5. Add a rebuild/repair job for existing buildings
Existing buildings already have mixed-quality data, so we need a one-time repair path:
- rebuild mappings per building from current `assets`, `xkt_models`, IFC metadata, and Asset+ attributes
- backfill model/storey/entity links
- flag unresolved rows for review instead of silently guessing

## 6. Optional but strongly recommended: build a per-building viewer manifest
Create a backend-generated manifest per building containing:
- models
- floors
- model-to-floor relations
- entity-to-asset mappings
- preferred display names

Then the viewer loads one manifest instead of reconstructing state from several tables and heuristics.

## Why this is better

This will remove the recurring classes of bugs:
- wrong level names
- wrong A-model selection
- missing/incorrect filter groups
- wrong object selected in viewer
- properties panel showing BIM fallback instead of full asset data
- unstable behavior across Asset+, IFC, and ACC buildings

## What I would implement first

### Phase 1
- Add `geometry_entity_map`
- Populate it from Asset+ sync and IFC import
- Update viewer selection + properties lookup to use it first

### Phase 2
- Refactor floor/model naming to use mapping instead of current heuristics
- Remove most of the file-name / `parentCommonName` inference logic

### Phase 3
- Add rebuild job for old buildings
- Add per-building viewer manifest for performance and stability

## Important conclusion

So: **no, the main problem is not that you have one XKT table and one asset table**.

The main problem is that the join between them is reconstructed differently in multiple places.

The right way forward is:
- keep geometry and assets separate
- introduce one authoritative mapping layer
- make all viewer, filter, floor, and property behavior depend on that layer

That is the cleanest way to streamline this process and remove the recurring mapping problems.
