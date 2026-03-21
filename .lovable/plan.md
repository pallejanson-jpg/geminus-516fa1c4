

## Plan: Mobile Responsiveness Fixes + Conditional Object Color Filters

### 1. CreateIssueDialog — Mobile scrollability fix

**Problem:** On mobile, the bottom-sheet form content overflows and isn't scrollable.

**Fix in `CreateIssueDialog.tsx`:**
- Change the mobile bottom-sheet container from `max-h-[90dvh]` to `max-h-[85dvh]` with `overflow-hidden flex flex-col`
- Make the form area `flex-1 overflow-y-auto` instead of relying on `max-h-[60vh]`
- Ensure footer stays pinned at the bottom with `flex-shrink-0`

### 2. Pick-position badge — Move out of center

**Problem:** The "Klicka för att välja position" badge sits dead center (`top-1/2 left-1/2 -translate-x/y-1/2`) and blocks the view.

**Fix in `NativeViewerShell.tsx` (line ~936):**
- Reposition to top-left with safe-area offset: `absolute top-3 left-3 z-50` (same pattern as `AssetRegistration.tsx`)
- Remove the centering transforms

### 3. Context menu won't close on outside tap (mobile)

**Problem:** The `mousedown` capture listener doesn't fire reliably on mobile touch. The xeokit canvas consumes touch events before they reach the document.

**Fix in `ViewerContextMenu.tsx`:**
- Add `touchstart` listener alongside `mousedown` in the click-outside handler (both in capture phase)
- Add a full-screen invisible backdrop `div` behind the menu (z-index below menu, above canvas) that closes on tap — more reliable than document-level listeners when xeokit swallows events

### 4. Color filters not working

**Problem:** The `RoomVisualizationPanel` accesses the viewer via the old Asset+ shim path (`viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer`). If the shim isn't fully wired or the native xeokit viewer is used directly, the path returns `undefined` and no colorization happens.

**Fix in `RoomVisualizationPanel.tsx`:**
- Add fallback viewer resolution: try the shim path first, then try `viewerRef.current?.viewer` (the native xeokit viewer directly)
- Extract viewer resolution into a shared helper used by entity cache builder, colorizeSpace, hover listener, and legend selection
- Ensure `entityIdCache` rebuild uses the same fallback

### 5. Conditional object color filters — New feature

**New component: `ObjectColorFilterPanel.tsx`** added to the Settings section of `VisualizationToolbar`.

Allows users to create rules that colorize **any** BIM object (not just spaces) based on property conditions.

**Data model (localStorage-persisted):**
```typescript
interface ColorFilterRule {
  id: string;
  name: string;           // e.g. "Fire doors EI60"
  color: string;          // hex color
  enabled: boolean;
  conditions: ColorFilterCondition[];
  logic: 'AND' | 'OR';   // how conditions combine
}

interface ColorFilterCondition {
  target: 'category' | 'property';  // IFC category or object property
  field: string;         // e.g. "IfcDoor", "FireRating", "Width"
  operator: 'equals' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte';
  value: string;
}
```

**UI design:**
- Added under "Viewer Settings" as a collapsible "Object color rules" section
- Each rule has: name field, color picker, one or more conditions (add/remove), AND/OR toggle
- Condition row: Category dropdown (IfcDoor, IfcWall, IfcSpace, etc.) + Property name input + Operator select + Value input
- Enable/disable toggle per rule
- "Apply" button that iterates metaScene objects, evaluates conditions, and sets `entity.colorize`

**Execution logic:**
- On apply, iterate all `metaScene.metaObjects`
- For each object, check if its `type` (IFC category) and properties match the conditions
- Properties come from the object's metadata or from `allData` attributes lookup by `originalSystemId`
- Matching objects get `entity.colorize = [r, g, b]`; non-matching get reset
- Persisted to localStorage so rules survive page reload

**Integration in `VisualizationToolbar.tsx`:**
- Add `ObjectColorFilterPanel` (embedded) inside the Settings collapsible, after the lighting controls
- Pass `viewerRef` and `buildingFmGuid`

### Files Modified

| File | Change |
|---|---|
| `src/components/viewer/CreateIssueDialog.tsx` | Fix mobile overflow: flex layout + proper scroll |
| `src/components/viewer/NativeViewerShell.tsx` | Move pick-position badge to top-left corner |
| `src/components/viewer/ViewerContextMenu.tsx` | Add touchstart listener + invisible backdrop for mobile close |
| `src/components/viewer/RoomVisualizationPanel.tsx` | Add fallback viewer resolution for native xeokit path |
| `src/components/viewer/ObjectColorFilterPanel.tsx` | **New** — conditional object color filter rules UI + logic |
| `src/components/viewer/VisualizationToolbar.tsx` | Integrate ObjectColorFilterPanel in Settings section |

