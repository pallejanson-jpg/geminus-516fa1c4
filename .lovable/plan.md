

# Save ACC/IFC → Asset+ Push Plan

The plan from the previous conversation is already well-defined. I will save it as a markdown file in `docs/plans/` alongside the existing plans.

## What I'll do

Create **one new file**:

**`docs/plans/acc-ifc-to-assetplus-push-plan.md`**

Contents will be the full plan text from the previous message, covering:
- Problem statement (filters blocking ~77,500 ACC/IFC objects)
- Database migration (add `model_id`, `revision_id` to `acc_assetplus_guid_map`)
- Extend `sync-structure` to create Complex → Building → Model → Revision for ACC/IFC buildings
- Remove `isNonAssetPlusGuid` filter from push actions
- Add GUID translation via `acc_assetplus_guid_map`
- Model revision linkage for `createdInModel=true` objects
- Update `check-delta` to include ACC objects
- Flow diagram and constraints

No code changes, no database changes — just saving the plan document.

