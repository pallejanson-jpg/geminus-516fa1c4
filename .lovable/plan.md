

# Plan: Fix Viewer Tools + Properties Dialog

## Problem 1: Select, Measure, Clip tools don't work

**Root cause**: The MobileViewerPage dispatches `VIEWER_TOOL_CHANGED_EVENT` with tool names ('select', 'measure', 'slicer'), but **nobody listens** for that event to actually activate the xeokit plugins. The plugin activation (`activateMeasure`, `activateSection`) only happens inside `ViewerToolbar.handleToolChange()`, which is triggered by internal button clicks — not by external events.

On mobile, `ViewerToolbar` is mounted but hidden (`opacity: 0`). Its buttons are not clickable. The mobile toolbar dispatches events but the desktop toolbar doesn't react to them.

**Fix in `ViewerToolbar.tsx`**: Add a `useEffect` that listens for `VIEWER_TOOL_CHANGED_EVENT` and calls the same activation/deactivation logic as `handleToolChange`. Guard against re-entrant calls (ignore events that ViewerToolbar itself dispatched).

```typescript
// Listen for external tool changes (e.g. from MobileViewerPage)
useEffect(() => {
  const handler = (e: CustomEvent<ViewerToolChangedDetail>) => {
    const tool = e.detail.tool as ViewerTool;
    // Skip if we dispatched this ourselves
    if ((e as any).__fromToolbar) return;
    
    // Deactivate previous
    if (activeTool === 'measure') deactivateMeasure();
    if (activeTool === 'slicer') deactivateSection();
    
    // Activate new
    if (tool === 'measure') activateMeasure();
    if (tool === 'slicer') activateSection();
    
    setActiveTool(tool);
  };
  window.addEventListener(VIEWER_TOOL_CHANGED_EVENT, handler);
  return () => window.removeEventListener(VIEWER_TOOL_CHANGED_EVENT, handler);
}, [activeTool, activateMeasure, deactivateMeasure, activateSection, deactivateSection]);
```

Also update `handleToolChange` to mark its dispatched events so the listener ignores them.

---

## Problem 2: Properties shows only BIM Metadata

**Root cause**: In `NativeViewerShell.handleContextProperties` (line 567), the GUID comparison uses `.toLowerCase()` but **does not strip hyphens**. The xeokit `originalSystemId` often has no hyphens (e.g., `abc123def456`) while the database `fm_guid` has standard UUID format with hyphens (`abc1-23de-f456`). The match fails, so `UniversalPropertiesDialog` receives only the raw entityId, queries Supabase with it, finds nothing, and falls back to BIM metadata.

**Fix in `NativeViewerShell.tsx`** — `handleContextProperties`: Normalize both sides by stripping hyphens before comparison.

```typescript
const handleContextProperties = useCallback(() => {
  if (!contextMenu) return;
  let resolvedFmGuid = contextMenu.fmGuid;
  const normalize = (g: string) => g.toLowerCase().replace(/-/g, '');

  if (resolvedFmGuid && allData?.length) {
    const norm = normalize(resolvedFmGuid);
    const match = allData.find((a: any) => a.fmGuid && normalize(a.fmGuid) === norm);
    if (match) resolvedFmGuid = match.fmGuid;
  }

  if (!resolvedFmGuid && contextMenu.entityId && allData?.length) {
    const norm = normalize(contextMenu.entityId);
    const match = allData.find((a: any) => a.fmGuid && normalize(a.fmGuid) === norm);
    if (match) resolvedFmGuid = match.fmGuid;
  }

  setPropertiesEntity({
    entityId: contextMenu.entityId || '',
    fmGuid: resolvedFmGuid,
    name: contextMenu.entityName,
  });
}, [contextMenu, allData]);
```

---

## Files to edit

| File | Change |
|------|--------|
| `ViewerToolbar.tsx` | Add listener for `VIEWER_TOOL_CHANGED_EVENT` to activate/deactivate measure & section plugins from external sources |
| `NativeViewerShell.tsx` | Fix `handleContextProperties` to normalize GUIDs by stripping hyphens before comparison |

