

## Plan: Remove Separate Technical Systems UI, Integrate into Existing Flows

### Current State
- The `ifc-to-xkt` edge function **already extracts systems** (IfcSystem, SystemName properties) and persists them to `systems`, `asset_system`, `asset_connections` tables as part of IFC conversion.
- The `acc-sync` edge function with `sync-bim-data` **already extracts systems** from BIM model properties during sync.
- The `asset-plus-sync` with `sync-systems` action extracts systems from Asset+ attribute data.
- There is a **separate "Technical Systems" card** in ApiSettingsModal with its own IFC upload and buttons that duplicates this functionality.

### Changes

#### 1. Remove the standalone Technical Systems UI section
In `src/components/settings/ApiSettingsModal.tsx`:
- Remove the "Technical Systems" `SyncProgressCard` and its IFC upload form, ACC button, and Asset+ system sync button from the Data tab.
- Remove related state variables (`isSyncingSystems`, `systemSyncResult`, `ifcSystemFile`, `ifcSystemBuildingGuid`, `ifcSystemMode`, `isImportingIfcSystems`, `ifcSystemImportResult`, `systemCount`).
- Remove `handleSyncSystems` and `handleImportIfcSystems` functions.

#### 2. Auto-trigger system sync after existing sync flows
- **IFC flow** (`CreateBuildingPanel.tsx`): After successful IFC conversion (which already runs `extractSystemsAndConnections` server-side), add a log line confirming systems were extracted. No extra call needed — `ifc-to-xkt` already does it.
- **ACC flow** (`ApiSettingsModal.tsx`): After `sync-bim-data` completes successfully for all files, automatically call `asset-plus-sync` with `action: 'sync-systems'` to extract systems from the synced attributes. Add a toast confirming system extraction.
- **Asset+ flow**: After the existing Asset+ structure/asset sync completes, automatically trigger `sync-systems`. This can be appended to the existing sync completion handler.

#### 3. Show system count in existing sync status
- Add system count display to the existing sync status check (already fetched via `checkSyncStatus`), so users can see how many systems exist without a separate card.

### Summary
No new UI elements. Systems are extracted automatically as part of existing IFC upload, ACC sync, and Asset+ sync workflows. The separate Technical Systems section is removed to simplify the settings panel.

