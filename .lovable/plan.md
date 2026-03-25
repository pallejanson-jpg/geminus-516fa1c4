
Fix this in two layers: viewer behavior and data mapping.

1. Hide the temperature indicator by default
- Stop restoring the active visualization type from local storage on Viewer start.
- Default the visualization state to `none` on mount/building change.
- Keep the legend/indicator hidden until the user explicitly chooses a Color Filter.

2. Diagnose the FMGUID mismatch as a canonical mapping problem
What I found already:
- In Centralstationen, both room GUIDs exist in the database for the same building:
  - `27675937-a278-4436-863f-a138edc4bad3` = correct Asset+ room with user-defined data
  - `34D5BBF1-A2EF-4EE9-83B4-B435E40F6EEF` = separate Space row with almost no data
- `geometry_entity_map` contains a mapping for the correct room `2767...`
- There is no mapping row for `34D5...`

This means the viewer is currently trusting the raw BIM/metaScene GUID (`originalSystemId`) in some paths, instead of resolving the clicked entity to the canonical asset GUID from the mapping layer.

3. Replace raw `originalSystemId` lookups with canonical entity -> asset resolution
Update selection/properties/colorization so they resolve in this order:
- `viewer-manifest` / `geometry_entity_map` mapping
- `asset_external_ids`
- then only as last fallback `metaObj.originalSystemId`

This needs to be applied in:
- `NativeViewerShell` when opening/updating the Properties panel
- `UniversalPropertiesDialog` when fetching the asset
- `RoomVisualizationPanel` when matching a room FMGUID to viewer entities for colorization

Goal:
- Clicking the room geometry that currently reports `34D5...` should resolve to the canonical asset `2767...`
- The Properties panel should then show the correct user-defined Asset+ data
- Room colorization should use the correct room’s sensor/user-defined attributes again

4. Add targeted mismatch diagnostics
Add temporary diagnostics for:
- picked `entityId`
- raw `metaObj.originalSystemId`
- resolved canonical asset GUID
- whether `geometry_entity_map` had a hit

This will make it easy to confirm the same failure pattern in Småviken.

5. Clean up duplicated/incorrect room identity data
Before doing a full sync, compare Centralstationen and Småviken for:
- duplicate Space rows with same room name but different GUIDs
- rows missing `geometry_entity_map`
- viewer entities whose raw GUID differs from mapped asset GUID

Recommended order:
- First fix the viewer to use canonical mapping
- Then run a targeted geometry mapping rebuild for affected buildings
- Only do a full building sync if the mapping rebuild shows the imported room identities themselves are corrupted upstream

6. Recommended recovery strategy
I do not recommend starting with a full re-sync.
Better sequence:
- Fix canonical resolution in the Viewer
- Validate Centralstationen on the known room `ENTRÉ`
- Validate Småviken on a few failing rooms
- If needed, rebuild geometry mappings for those buildings
- Only then consider a full re-sync if duplicates continue to be created from source data

Files to update
- `src/components/viewer/VisualizationLegendOverlay.tsx` or visualization state source
- `src/components/viewer/RoomVisualizationPanel.tsx`
- `src/components/viewer/NativeViewerShell.tsx`
- `src/components/common/UniversalPropertiesDialog.tsx`
- optionally the viewer manifest / mapping consumption path if not already wired into the native viewer

Expected outcome
- No temperature indicator on Viewer startup
- Clicking a room resolves to the correct Asset+ room FMGUID
- Properties panel shows the correct user-defined properties
- Temperature/CO2/etc. coloring works again for Centralstationen and Småviken without depending on the wrong BIM GUID
