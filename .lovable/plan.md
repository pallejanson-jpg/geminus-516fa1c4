

## Plan: Map IFC/Asset+ Categories to FM Access Target Classes

### What the Images Reveal

FM Access uses **target class names** (not just numeric classIds) for import domain matching. The screenshots show two import domain configurations:

**IFC → FM Access mapping (image 1):**

| Source Class (IFC) | Target Class (FM Access) |
|---|---|
| HdcPlan | arkitekt |
| IfcBuilding | fmo_struct |
| IfcBuildingStorey | fmo_floor |
| IfcSpace | fmo_space_i |
| IfcSite | fmo_prop |
| IfcDoor | fmo_equip_door |
| IfcWindow | fmo_equip_window |
| IfcFlowTerminal | fmo_equip_flowterminals |
| IfcBuildingElementProxy | fmo_equip_electricappliance |

**Asset+ → FM Access mapping (image 2):**

| Source Class (Asset+) | Target Class (FM Access) | Condition |
|---|---|---|
| Space | fmo_space_i | |
| Building Storey | fmo_floor | |
| Door | fmo_equip_door | |
| Window | fmo_equip_window | |
| BuildingElementProxy | fmo_equip_appliance | Underhållsobjekt = Ja |
| BuildingElementProxy | fmo_equip_units | |
| DistributionControlElement | fmo_equip_fire | |
| FlowTerminal | fmo_equip_fire | |
| Alarm | fmo_equip_fire | |

**Property mapping (image 1, section 3)** shows how IFC properties map to FM Access fields for each class — e.g. for IfcSpace: `BIP|UsableFloorArea → space_bra`, `BIP|FMGUID → space_guid`, `BIP|Number → space_name`, etc.

### Current Problem

The `sync-object` and `ensure-hierarchy` actions create objects with only `classId` (numeric) but **no target class name**. FM Access needs the target class to route objects into the correct import domain (e.g. `fmo_equip_door` for doors). Without it, objects land unclassified.

Additionally, properties are sent as generic key-value pairs rather than using FM Access's domain-specific field names (like `equip_descr`, `equip_manufacturer`, `space_bra`).

### Implementation

#### 1. IFC/Asset+ → FM Access Target Class Mapping

Add a mapping function to `supabase/functions/fm-access-query/index.ts`:

```text
function resolveTargetClass(assetType: string, category: string): { classId: number; targetClass: string }

IFC Type / Asset+ Category        classId    targetClass
──────────────────────────────    ────────   ─────────────────────
IfcBuilding / Building             103       fmo_struct
IfcBuildingStorey / Level          105       fmo_floor
IfcSpace / Space                   107       fmo_space_i
IfcDoor / Door                     —         fmo_equip_door
IfcWindow / Window                 —         fmo_equip_window
IfcFlowTerminal / FlowTerminal     —         fmo_equip_flowterminals
IfcSensor / Alarm                  —         fmo_equip_fire
IfcFireSuppression* / Fire         —         fmo_equip_fire
DistributionControlElement         —         fmo_equip_fire
IfcBuildingElementProxy            —         fmo_equip_electricappliance
IfcFurniture / Furniture           —         fmo_equip_units
(default Instance)                 —         fmo_equip_appliance
```

The function accepts both IFC type names (e.g. `IfcDoor`) and Asset+ short names (e.g. `Door`) and normalizes them.

#### 2. Property Name Mapping per Target Class

Add a property mapper function that translates Geminus/Asset+ property names to FM Access field names based on the target class:

```text
function mapPropertiesToFmAccess(targetClass: string, props: Record<string,any>): Record<string,any>

For fmo_space_i:
  commonName          → space_name
  usableFloorArea     → space_bra
  grossFloorArea      → space_bta
  netFloorArea        → space_nta
  fmGuid              → space_guid
  globalId            → space_id
  typeId/function     → space_function
  averageClearHeight  → space_unboundedheight
  occupancyNumber     → space_ru_nr

For fmo_equip_door:
  commonName          → equip_name
  description         → equip_descr
  manufacturer        → equip_manufacturer
  warrantyTime        → equip_warranty_time
  fireClass           → equip_fire_class
  soundClass          → equip_sound_class
  material            → equip_material

For fmo_equip_window:
  commonName          → equip_name
  description         → equip_descr

For fmo_equip_fire:
  commonName          → equip_name
  description         → equip_descr
```

#### 3. Update `sync-object` Create Payload

**File: `supabase/functions/fm-access-query/index.ts`** (~line 894)

Before building the create payload, resolve the target class from `ifcType` and `category` parameters:

```typescript
const { targetClass, classId } = resolveTargetClass(ifcType, category);
const mappedProps = mapPropertiesToFmAccess(targetClass, syncProps || {});

const createPayload: any = {
  objectName: syncName,
  parentGuid: syncParentGuid,
  systemGuid: fmGuid,
  classId: classId,           // numeric HDC class (if applicable)
  targetClass: targetClass,    // FM Access import domain class
  properties: mappedProps,     // domain-specific field names
};
```

#### 4. Update `ensure-hierarchy` Payload

The hierarchy creation already uses correct classIds (102, 103, 105, 107). Add corresponding `targetClass` values:
- Fastighet (102): no targetClass needed (top-level)
- Byggnad (103): `fmo_struct`
- Plan (105): `fmo_floor`
- Rum (107): `fmo_space_i` — and map room properties to `space_*` fields

#### 5. Update Service Layer

**File: `src/services/fm-access-service.ts`** (~line 131)

Pass `ifcType` and `category` to the edge function:

```typescript
const { data, error } = await supabase.functions.invoke("fm-access-query", {
  body: { 
    action: "sync-object",
    fmGuid: asset.fm_guid,
    name: asset.name || asset.common_name || "Unnamed",
    parentGuid: parentGuid || undefined,
    properties: Object.keys(properties).length > 0 ? properties : undefined,
    localUpdatedAt: asset.updated_at,
    ifcType: asset.asset_type,    // e.g. "IfcDoor"
    category: asset.category,      // e.g. "Instance", "Space"
  },
});
```

### Files to Modify

| File | Changes |
|---|---|
| `supabase/functions/fm-access-query/index.ts` | Add `resolveTargetClass()` and `mapPropertiesToFmAccess()` helpers; update `sync-object` create payload with targetClass + mapped properties; update `ensure-hierarchy` payloads with targetClass |
| `src/services/fm-access-service.ts` | Pass `asset_type` as `ifcType` and `category` to sync-object call |

### Implementation Order

1. Add `resolveTargetClass()` mapping function (IFC + Asset+ names → FM Access target class)
2. Add `mapPropertiesToFmAccess()` property mapper per target class
3. Update `sync-object` to include `targetClass` and mapped properties in create payload
4. Update `ensure-hierarchy` to include `targetClass` for Byggnad/Plan/Rum
5. Update `syncAssetWithFmAccess` in service layer to pass `ifcType` and `category`
6. Test with Stadshuset Nyköping — verify objects appear under correct FM Access tabs

