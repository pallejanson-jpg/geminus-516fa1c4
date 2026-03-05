

# Updated Plan: System Support + Reconciliation Engine

## What changed from previous plan

The ChatGPT discussion adds two important concepts:

1. **`asset_external_ids` table** — Maps multiple external identifiers (IFC GUID, Revit UniqueId, ACC externalId) to a single `fm_guid`, enabling reconciliation across model versions and sources
2. **Reconciliation Engine** — Multi-step matching logic (GUID match → spatial+type match → create new) to prevent duplicate assets when re-importing models

The existing `assets.attributes` (jsonb) already covers dynamic properties, so no separate `FMProperty` table is needed. The spatial tables (`FMRoom`, `FMFloor`, `FMBuilding`) are already covered by the existing `assets` table hierarchy.

## Database changes (4 new tables)

### 1. `asset_external_ids`
Maps external IDs from multiple sources to stable `fm_guid`.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| fm_guid | text NOT NULL | References assets.fm_guid |
| source | text NOT NULL | 'ifc', 'acc', 'revit' |
| external_id | text NOT NULL | The external GUID/ID |
| model_version | text | Version tracking |
| last_seen_at | timestamptz | For stale detection |
| UNIQUE(fm_guid, source) | | One mapping per source |

### 2. `systems`
Technical systems (e.g., LB01 Supply Air).

| Column | Type |
|--------|------|
| id | uuid PK |
| fm_guid | text UNIQUE | Stable system identity |
| name | text NOT NULL |
| system_type | text | Supply Air, Return Air, etc. |
| discipline | text | Ventilation, Heating, Electrical |
| source | text | 'ifc', 'acc', 'manual' |
| building_fm_guid | text |
| parent_system_id | uuid | Hierarchical systems |
| is_active | boolean DEFAULT true |
| created_at/updated_at | timestamptz |

### 3. `asset_system`
Many-to-many: asset ↔ system.

| Column | Type |
|--------|------|
| id | uuid PK |
| asset_fm_guid | text NOT NULL |
| system_id | uuid NOT NULL |
| role | text | 'terminal', 'main_unit', etc. |
| UNIQUE(asset_fm_guid, system_id) | |

### 4. `asset_connections`
Topology/flow between assets.

| Column | Type |
|--------|------|
| id | uuid PK |
| from_fm_guid | text NOT NULL |
| to_fm_guid | text NOT NULL |
| connection_type | text | 'airflow', 'piping', 'electrical' |
| direction | text | 'supply', 'return', 'bidirectional' |
| source | text | 'ifc', 'acc', 'manual' |
| UNIQUE(from_fm_guid, to_fm_guid, connection_type) | |

### RLS policies
All four tables: authenticated can read, admin can write, service role full access.

## Reconciliation Engine

Implemented inside edge functions (`ifc-to-xkt` and `acc-sync`) using this matching strategy:

```text
New model object arrives
  │
  ├─ Step 1: Match external_id in asset_external_ids
  │   → Found? Use that fm_guid, update LastSeen
  │
  ├─ Step 2: Fallback match on category + room + type
  │   → Found? Use that fm_guid, create external_id mapping
  │
  └─ Step 3: No match → Create new asset with new fm_guid
                         Create external_id mapping
```

This is TypeScript in edge functions, not Python — the ChatGPT Python examples are translated to work within the existing Supabase edge function architecture.

## Implementation in edge functions

### `ifc-to-xkt/index.ts` additions
After XKT parsing, extract from `xktModel.metaObjects`:
- Objects with `metaType === 'IfcSystem'` → create `systems` rows
- Objects with `parentMetaObjectId` pointing to a system → create `asset_system` rows
- Fallback: group by `SystemName` property → auto-create systems
- Store `IfcGUID` in `asset_external_ids` for each parsed object
- Extract `IfcRelConnects` data → `asset_connections` rows

### `acc-sync/index.ts` additions
In `extractBimHierarchy()`:
- Resolve `System Name`, `System Type` property fields (same pattern as existing level/room resolution)
- Group instances by `SystemName` → create `systems` + `asset_system` rows
- Store ACC `externalId` in `asset_external_ids`
- Apply reconciliation matching before creating new assets

## Frontend (later phase)

1. **System tab** on FacilityLandingPage — list systems per building, click to see member assets
2. **System badge** on asset property dialogs — show which systems an asset belongs to
3. **Manual system creation** — dialog for creating/editing systems and linking assets

## Implementation order

1. Database migration (4 tables + RLS)
2. Update `ifc-to-xkt` with system extraction + external ID mapping
3. Update `acc-sync` with system property resolution + reconciliation
4. Frontend system views

