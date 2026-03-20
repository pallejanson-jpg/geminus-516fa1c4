

## Plan: Fix Asset+ Room Relation + FM Access GUID Handling

### Problem 1: Asset+ — Room Relation for Fire Extinguishers

Asset+ `AddObjectList` does not accept a Space (room) GUID as `ParentFmGuid` for Instance objects — it requires the **building** GUID. To establish the room relationship afterward, the system must call `UpsertRelationships` as a second step.

**Current behavior:** `asset-plus-create` sets `ParentFmGuid` to either room or building, but room-parented creates fail silently or get rejected.

**Fix in `supabase/functions/asset-plus-create/index.ts`:**
1. Always use `parentBuildingFmGuid` as the `ParentFmGuid` in `AddObjectList`
2. After successful creation, if `parentSpaceFmGuid` is provided, call `UpsertRelationships` to move the Instance under the room:
   ```
   POST /UpsertRelationships
   { Relationships: [{ ParentFmGuid: roomGuid, ChildFmGuid: assetFmGuid }] }
   ```
3. Update `resolveParent()` to always prefer building GUID for the initial create call, and store the room GUID separately for the relationship step
4. Both single and batch flows get the same two-step logic

### Problem 2: FM Access — Use raw `fm_guid` as `systemGuid`

The `create-object` action currently uses `parentGuid` but does NOT pass `systemGuid` (the FM GUID from Geminus). The `sync-object` action already does this correctly (line 1043: `systemGuid: fmGuid`).

**Fix in `supabase/functions/fm-access-query/index.ts`:**
1. Update the `create-object` action to accept and pass `systemGuid` (= the asset's `fm_guid`) in the POST payload to `/api/object`
2. Also pass `targetClass` when provided, matching the pattern used in `ensure-hierarchy` and `sync-object`

**Updated `create-object` payload:**
```json
{
  "objectName": "BS-01.1-001",
  "parentGuid": "<room-guid-in-fma>",
  "systemGuid": "<geminus-fm-guid>",
  "classId": 107,
  "targetClass": "fmo_component_i"
}
```

### Files Modified
| File | Change |
|---|---|
| `supabase/functions/asset-plus-create/index.ts` | Two-step create: AddObjectList with building parent → UpsertRelationships to room |
| `supabase/functions/fm-access-query/index.ts` | Pass `systemGuid` and `targetClass` in `create-object` action |

### Technical Detail
- `UpsertRelationships` only works for `createdInModel=false` objects (which inventory objects are)
- The `systemGuid` in FM Access (HDC) is the cross-system identifier — equivalent to `fm_guid` in Geminus and Asset+

