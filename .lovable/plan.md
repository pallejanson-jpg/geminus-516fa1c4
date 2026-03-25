
# Plan: Temperature Indicator Default, Canonical FMGUID Resolution

## Completed Changes

### 1. Hide temperature indicator on viewer startup
**Files:** `src/components/viewer/RoomVisualizationPanel.tsx`
- Removed localStorage restoration of visualizationType; always starts as `'none'`
- Added reset to `'none'` when `buildingFmGuid` changes

### 2. Canonical FMGUID resolution (BIM → Asset+)
**Files:** `src/components/viewer/NativeViewerShell.tsx`, `src/components/common/UniversalPropertiesDialog.tsx`

Root cause: BIM models have their own Space GUIDs (e.g., `34D5BBF1...`) that differ from the canonical Asset+ GUIDs (e.g., `27675937...`). Both exist as separate rows in the `assets` table, but only the Asset+ row has user-defined attributes.

Resolution strategy (name-based canonical matching):
1. When an entity is clicked, get `originalSystemId` as raw GUID
2. Check if that GUID matches an asset with attributes → use it
3. If not, and the entity is an IfcSpace, find another Space in the same building with the same `common_name` that HAS attributes → use that
4. Fallback to `asset_external_ids` table
5. Final fallback: use raw GUID as-is

Applied in NativeViewerShell:
- Select tool click handler (pinned properties update)
- Context menu right-click
- Context menu long-press (mobile)
- `handleContextProperties` (already had allData-based resolution)

Applied in UniversalPropertiesDialog:
- Data fetch `useEffect` now checks if direct match has user data; if not, performs name-based DB lookup

### 3. DB Diagnostics
Confirmed in Centralstationen:
- `27675937-...` = correct Asset+ ENTRÉ with attributes + geometry_entity_map entry
- `34D5BBF1-...` = BIM-imported ENTRÉ with no attributes, no geometry_entity_map
- `13779DB0-...` = another BIM-imported ENTRÉ with no attributes
- Same pattern expected in Småviken

## No backend changes needed
