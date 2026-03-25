

# Plan: Fix Multiple Issues — Visualization, Properties, Settings, Translations, Ilean on Home

## Summary

Address 7 distinct issues: translate visualization labels to English, fix the properties panel showing too few properties, collapse Viewer Settings by default, translate Insight tabs, activate Ilean on home page, and answer the RAG Search demo question.

## Answer: RAG Search Documents

You have **1 document** indexed for building **Småviken** (`a8fe5835-e293-4ba3-92c6-c7e36f675f23`). That's the building to demo RAG Search.

## Answer: Properties Panel (EB2F1C94...)

That Space has `attributes: null` in the database — it has no stored properties beyond the basic columns. The properties panel correctly shows what's available. The `SKIP_ATTR_KEYS` filter is not the problem; there are simply no attributes stored for that room. The panel does show all DB columns (fm_guid, category, name, etc.) — but since `attributes` is null, no user-defined or Asset+ properties appear.

However, the panel should also show BIM metadata from the viewer's `metaScene` (propertySets). It tries to do this via `entityId`, but when opened from the viewer by clicking a space, the `entityId` may not be passed. I will ensure BIM property sets are always shown when available.

## Changes

### 1. Translate visualization labels to English
**File:** `src/lib/visualization-utils.ts`

Change all `label` values in `VISUALIZATION_CONFIGS`:
- `Temperatur` → `Temperature`
- `Luftfuktighet` → `Humidity`
- `Beläggning` → `Occupancy`
- `Belysning` → `Light`
- `Yta (NTA)` → `Area (NTA)`
- `Anomalier` → `Anomalies`
- `Ingen` → `None`
- `poäng` → `score`

### 2. Collapse Viewer Settings by default
**File:** `src/components/viewer/VisualizationToolbar.tsx`

Change line 374:
```typescript
const [viewerSettingsOpen, setViewerSettingsOpen] = useState(false);
```

### 3. Properties panel: show BIM metadata even without entityId
**File:** `src/components/common/UniversalPropertiesDialog.tsx`

When the panel opens for a single fmGuid with null attributes, attempt to find the matching metaObject in the viewer by scanning `metaScene.metaObjects` for an object whose `originalSystemId` matches the fmGuid (case-insensitive). This ensures BIM property sets (propertySets) are displayed even when `entityId` is not explicitly passed. The BIM fallback data is already rendered — the issue is that the lookup only triggers when `entityId` is provided.

### 4. Activate Ilean on the home page
**File:** `src/components/home/HomeLanding.tsx`

- Import `IleanEmbeddedChat` (or the `IleanButton` component).
- Change the `openAssistant` handler for `ilean` to open an Ilean chat panel instead of showing "coming soon" toast.
- Add state `ileanOpen` and render the Ilean embedded chat in a floating panel (same pattern as Gunnar).

### 5. Translate Insight AI tab labels
**Files:**
- `src/components/insights/tabs/PredictiveMaintenanceTab.tsx` — already in English, confirmed OK.
- `src/components/insights/tabs/RoomOptimizationTab.tsx` — already in English, confirmed OK.
- `src/components/insights/tabs/RagSearchTab.tsx` — already in English, confirmed OK.

These tabs are already in English. No changes needed.

### 6. Translate BIP classification labels in properties panel
**File:** `src/components/common/UniversalPropertiesDialog.tsx`

- `BIP Typbeteckning` → `BIP Type Code`
- `BIP Kod` → `BIP Code`

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/visualization-utils.ts` | Translate all VISUALIZATION_CONFIGS labels/units to English |
| `src/components/viewer/VisualizationToolbar.tsx` | Set `viewerSettingsOpen` default to `false` |
| `src/components/common/UniversalPropertiesDialog.tsx` | Add BIM metaScene lookup by fmGuid when entityId is missing; translate BIP labels |
| `src/components/home/HomeLanding.tsx` | Add Ilean chat panel (same pattern as Gunnar) |

