
# Plan: Grid Navigation and Multi-Select Properties Dialog

## Overview

This plan implements three key behaviors for the detailed grid views (Assets and Rooms):

1. **Row click → Landing page**: Clicking a row navigates to that object's FacilityLandingPage
2. **Checkbox selection → Properties dialog**: Selecting one or more checkboxes shows the UniversalPropertiesDialog
3. **Multi-select editing**: When multiple items are selected, show "Different values" for mismatched fields and allow batch editing

---

## Current Behavior Analysis

| Action | RoomsView | AssetsView |
|--------|-----------|------------|
| Row click | Opens landing page | Does nothing |
| Checkbox | Toggles selection | Toggles selection |
| "Egenskaper" button | Only works for single selection | Only works for single selection |

---

## Proposed UX Flow

```text
+------------------------------------------+
| ☐ | Name      | Type   | Floor | Actions |
+------------------------------------------+
| ☑ | Door-001  | Door   | Plan 1| [3D]    |  ← Checkbox = select
| ☐ | Window-02 | Window | Plan 1| [3D]    |  ← Row click = landing page
| ☑ | Beam-03   | Beam   | Plan 2| [3D]    |
+------------------------------------------+

When 2 items selected → Properties dialog shows:
+--------------------------------------------+
| Properties (2 items selected)              |
+--------------------------------------------+
| Name:        | Different values        [▼] |
| Type:        | Door                    [▼] |  ← Same value, editable
| Floor:       | Different values        [▼] |
| Category:    | Instance                    |  ← Read-only, grayed out
+--------------------------------------------+
| [Cancel]                      [Save All]   |
+--------------------------------------------+
```

---

## Implementation Details

### Part 1: Row Click → Landing Page

**File: `src/components/portfolio/AssetsView.tsx`**

Add `onSelectAsset` prop and onClick handler:

```tsx
interface AssetsViewProps {
  // ... existing props
  onSelectAsset?: (fmGuid: string) => void;
}

// In TableRow (line ~865):
<TableRow 
  key={asset.fmGuid} 
  className={`hover:bg-muted/30 cursor-pointer ${...}`}
  onClick={() => onSelectAsset?.(asset.fmGuid)}  // NEW
>
```

**File: `src/components/portfolio/PortfolioView.tsx`**

Add handler similar to `handleSelectRoom`:

```tsx
const handleSelectAsset = (fmGuid: string) => {
  const asset = allData.find((a: any) => a.fmGuid === fmGuid);
  if (asset) {
    setSelectedFacility({
      fmGuid: asset.fmGuid,
      name: asset.name,
      commonName: asset.commonName,
      category: asset.category || 'Instance',
      levelFmGuid: asset.levelFmGuid,
      buildingFmGuid: asset.buildingFmGuid,
      attributes: asset.attributes,
    });
    setShowAssetsFor(null);
  }
};

// Pass to AssetsView:
<AssetsView
  ...
  onSelectAsset={handleSelectAsset}
/>
```

---

### Part 2: Auto-Show Properties on Selection

**File: `src/components/portfolio/AssetsView.tsx`**

Replace manual "Egenskaper" button with automatic dialog when selection changes:

```tsx
// Show properties dialog automatically when items are selected
useEffect(() => {
  if (selectedRows.size > 0) {
    setShowPropertiesFor(Array.from(selectedRows));
  } else {
    setShowPropertiesFor(null);
  }
}, [selectedRows]);

// Change state type
const [showPropertiesFor, setShowPropertiesFor] = useState<string[] | null>(null);
```

---

### Part 3: Multi-Select UniversalPropertiesDialog

**File: `src/components/common/UniversalPropertiesDialog.tsx`**

Major refactoring to support multiple items:

#### 3.1 Update Props Interface

```tsx
interface UniversalPropertiesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  fmGuids: string[];  // Changed from fmGuid: string
  category?: string;
  onUpdate?: () => void;
}
```

#### 3.2 New State for Multi-Item Data

```tsx
const [assets, setAssets] = useState<any[]>([]);
const [isMultiMode, setIsMultiMode] = useState(false);

// Computed merged properties
const mergedProperties = useMemo(() => {
  if (assets.length === 0) return [];
  if (assets.length === 1) return computePropertiesForSingleAsset(assets[0]);
  
  return computeMergedProperties(assets);
}, [assets]);
```

#### 3.3 Merge Logic Function

```tsx
function computeMergedProperties(assets: any[]): MergedPropertyItem[] {
  // Get all property keys from all assets
  const allKeys = new Set<string>();
  assets.forEach(asset => {
    Object.keys(asset).forEach(key => allKeys.add(key));
    // Also iterate attributes
    if (asset.attributes) {
      Object.keys(asset.attributes).forEach(key => allKeys.add(`attr_${key}`));
    }
  });

  const merged: MergedPropertyItem[] = [];
  
  allKeys.forEach(key => {
    const values = assets.map(a => getPropertyValue(a, key));
    const uniqueValues = [...new Set(values.map(v => JSON.stringify(v)))];
    
    merged.push({
      key,
      label: getPropertyLabel(key),
      value: uniqueValues.length === 1 ? values[0] : null,
      isDifferent: uniqueValues.length > 1,
      editable: EDITABLE_KEYS.includes(key),
      differentCount: uniqueValues.length,
    });
  });

  return merged;
}
```

#### 3.4 Updated UI for "Different values"

```tsx
const renderPropertyValue = (prop: MergedPropertyItem) => {
  if (prop.isDifferent && !isEditing) {
    return (
      <span className="text-muted-foreground italic flex items-center gap-1">
        <AlertCircle className="h-3 w-3" />
        Different values ({prop.differentCount})
      </span>
    );
  }
  
  if (isEditing && prop.editable) {
    return (
      <div className="flex flex-col gap-1">
        {prop.isDifferent && (
          <span className="text-xs text-amber-500">Will overwrite all</span>
        )}
        <Input
          value={formData[prop.key] ?? ''}
          placeholder={prop.isDifferent ? 'Enter new value for all...' : undefined}
          onChange={(e) => setFormData({...formData, [prop.key]: e.target.value})}
        />
      </div>
    );
  }
  
  // ... existing render logic
};
```

#### 3.5 Batch Save Handler

```tsx
const handleSave = async () => {
  setIsSaving(true);
  
  try {
    // Build update payload (only changed fields)
    const updatePayload: Record<string, any> = {};
    Object.entries(formData).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        updatePayload[key] = value;
      }
    });

    if (Object.keys(updatePayload).length === 0) {
      toast.info('No changes to save');
      setIsEditing(false);
      return;
    }

    // Batch update all selected assets
    const { error } = await supabase
      .from('assets')
      .update(updatePayload)
      .in('fm_guid', fmGuids);

    if (error) throw error;

    toast.success(`Updated ${fmGuids.length} items`);
    setIsEditing(false);
    onUpdate?.();
  } catch (error: any) {
    toast.error('Error saving: ' + error.message);
  } finally {
    setIsSaving(false);
  }
};
```

---

### Part 4: Same Changes for RoomsView

Apply identical changes to `src/components/portfolio/RoomsView.tsx`:
- Auto-show properties dialog on selection
- Update state type to `string[]`
- Pass array to UniversalPropertiesDialog

---

## File Changes Summary

| File | Changes |
|------|---------|
| `src/components/common/UniversalPropertiesDialog.tsx` | Support multi-select, "Different values" UI, batch save |
| `src/components/portfolio/AssetsView.tsx` | Row click → landing page, auto-show properties on selection |
| `src/components/portfolio/RoomsView.tsx` | Auto-show properties on selection, pass array to dialog |
| `src/components/portfolio/PortfolioView.tsx` | Add `handleSelectAsset` handler, pass to AssetsView |

---

## Editable vs Read-Only Fields

| Field | Editable | Notes |
|-------|----------|-------|
| `common_name` | Yes | Display name |
| `asset_type` | Yes | Classification |
| `coordinate_x/y/z` | Yes | Position |
| `fm_guid` | No | System identifier |
| `category` | No | IFC category |
| `building_fm_guid` | No | Hierarchy reference |
| `level_fm_guid` | No | Hierarchy reference |
| `is_local` | No | System status |
| `created_in_model` | No | System status |
| Attributes from Asset+ | No | External system data |

---

## Implementation Order

1. **UniversalPropertiesDialog** - Multi-select support with "Different values"
2. **PortfolioView** - Add `handleSelectAsset` handler
3. **AssetsView** - Row click navigation + auto-show dialog
4. **RoomsView** - Auto-show dialog on selection

---

## Technical Notes

### Backward Compatibility
The dialog should support both single GUID (legacy) and array:
```tsx
// Accept both formats
fmGuids: string | string[];

// Normalize internally
const normalizedGuids = Array.isArray(fmGuids) ? fmGuids : [fmGuids];
```

### Performance Consideration
For large selections (>50 items), consider:
- Pagination in the fetch query
- Limiting editable fields in multi-mode
- Adding a warning about batch operations
