

## Plan: Map IFC Categories to FM Access ClassIds for Correct Object Classification

### Problem Identified

When syncing objects to FM Access, the current code creates objects **without a `classId`** in the POST payload (line 894 of `fm-access-query/index.ts`). FM Access uses `classId` to determine which domain/tab an object appears under. Without it, objects end up unstructured — a door doesn't appear as a door, a sensor doesn't appear as a sensor, etc.

The `asset_type` (e.g. `IfcDoor`, `IfcWindow`, `IfcSensor`) is only sent as a text property, not as the structural `classId` that FM Access needs.

### What Needs to Happen

#### 1. Discover Available HDC ClassIds

We only know 5 classIds today (102=Fastighet, 103=Byggnad, 105=Plan, 106=Ritning, 107=Rum). FM Access likely has classIds for equipment objects (Objekt, Installationer, etc.). We need to:

- Use the `proxy` action to call `GET /api/classes/json` or similar endpoint to list all available HDC class types
- Determine which classIds map to IFC categories like doors, windows, sensors, fire equipment, etc.

If FM Access uses a generic "Objekt" classId for all equipment (common in Swedish FM systems), then all non-structural items may share one classId, with IFC type stored as a property.

#### 2. Build IFC → HDC ClassId Mapping

Create a mapping table in the edge function:

```text
IFC Type                    HDC ClassId    Description
─────────────────────────   ───────────    ───────────
IfcSpace                    107            Rum
IfcBuildingStorey           105            Plan
IfcBuilding                 103            Byggnad
IfcDoor                     ???            Dörr / Objekt
IfcWindow                   ???            Fönster / Objekt
IfcWall                     ???            Vägg / Objekt
IfcSensor                   ???            Sensor / Objekt
IfcFireSuppressionTerminal  ???            Brandredskap / Objekt
IfcFurniture                ???            Möbel / Objekt
```

The `???` values need to be discovered from the FM Access API. If there is no specific classId for doors vs windows, they likely all use a generic "Objekt" classId (possibly 108 or similar), with the IFC type stored as a property that FM Access uses for its import domain filtering.

#### 3. Update Edge Function: `sync-object`

**File: `supabase/functions/fm-access-query/index.ts`** (lines ~894-901)

Add `classId` to the create payload based on the asset's IFC type:

```typescript
const createPayload: any = {
  objectName: syncName,
  parentGuid: syncParentGuid,
  systemGuid: fmGuid,
  classId: resolveHdcClassId(syncProps?.assetType || syncProps?.ifcType),  // NEW
};
```

Add a helper function `resolveHdcClassId(ifcType: string): number` that maps IFC types to HDC classIds.

#### 4. Update Service Layer: Pass `asset_type` Explicitly

**File: `src/services/fm-access-service.ts`**

Ensure `asset_type` is passed as a top-level parameter (not just inside `properties`) so the edge function can use it for classId resolution:

```typescript
const { data, error } = await supabase.functions.invoke("fm-access-query", {
  body: { 
    action: "sync-object",
    fmGuid: asset.fm_guid,
    name: asset.name || asset.common_name || "Unnamed",
    parentGuid: parentGuid || undefined,
    properties: ...,
    localUpdatedAt: asset.updated_at,
    ifcType: asset.asset_type,  // NEW — used for classId resolution
    category: asset.category,    // NEW — Level, Space, etc.
  },
});
```

#### 5. API Discovery Step (First)

Before implementing the mapping, add a one-time discovery call to `fm-access-query`:

**New action: `list-classes`** — calls `GET /api/classes/json` (or equivalent) to return all available HDC class definitions with their IDs and names. This tells us exactly which classIds are available in the customer's FM Access instance.

### Files to Modify

| File | Changes |
|---|---|
| `supabase/functions/fm-access-query/index.ts` | Add `list-classes` action; add `resolveHdcClassId()` helper; add `classId` to `sync-object` create payload; accept `ifcType` parameter |
| `src/services/fm-access-service.ts` | Pass `asset_type` as `ifcType` and `category` to the edge function call |

### Implementation Order

1. Add `list-classes` action to edge function (discover available HDC classIds)
2. Add `resolveHdcClassId()` mapping function with known IFC→HDC mappings
3. Update `sync-object` to include `classId` in create payload
4. Update `syncAssetWithFmAccess` to pass `ifcType` and `category`
5. Test with Stadshuset Nyköping — verify objects land in correct FM Access domains

