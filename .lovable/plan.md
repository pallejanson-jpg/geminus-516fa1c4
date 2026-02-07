

# Systematisk fix av alla verktyg i 3D-viewerns toolbar

## Sammanfattning

Jag har granskat samtliga verktyg i nedre toolbaren (`ViewerToolbar.tsx`), hogerpanelen (`ViewerRightPanel.tsx`), och visualiseringsmenyn (`VisualizationToolbar.tsx`). Tre grundlaggande problem paverkar manga verktyg:

1. **Global `isProcessing`-las blockerar ALLA knappar** -- varje knapptryckning laser hela toolbaren i 100ms (upp till 2 sek vid fel)
2. **Hover highlight har fel event-signatur** -- xeokit-eventet skickar `(canvasCoords, hit)` men handleren tolkar forsta parametern fel
3. **X-ray saknar UI-implementation** -- finns i installningarna men ingen kod renderar eller togglar det

## Verktygsaudit -- alla 11 navigationsverktyg + 8 visualiseringsverktyg

### Nedre toolbar (ViewerToolbar.tsx) -- Navigationsverktyg

| Verktyg | Status | Problem |
|---------|--------|---------|
| orbit | Fungerar varannan gang | `isProcessing`-las blockerar klick |
| firstPerson | Fungerar varannan gang | Samma `isProcessing`-las |
| zoomIn | Fungerar varannan gang | `isProcessing` blockar; anropar aldrig `useTool()` men las andamolost |
| zoomOut | Fungerar varannan gang | Samma som zoomIn |
| viewFit | Fungerar varannan gang | Samma `isProcessing`-las |
| resetView | Fungerar varannan gang | Samma `isProcessing`-las |
| select | Fungerar varannan gang | `isProcessing` + `handleToolChange` debounce |
| measure | Fungerar varannan gang | Samma som select |
| slicer | Fungerar varannan gang | Samma som select |
| flashOnSelect | Fungerar varannan gang | `isProcessing` paverkar aven toggle-knappar |
| hoverHighlight | Fungerar inte alls | Toggle blockeras av `isProcessing` + event-handler bugg i `AssetPlusViewer.tsx` |

### Hogerpanel / Visualiseringsmeny -- Visualiseringsverktyg

| Verktyg | Status | Problem |
|---------|--------|---------|
| xray | Fungerar inte | Ingen UI-kod finns -- bara en ToolbarSettings-post utan rendering |
| spaces | Fungerar (OK) | Inget problem hittat |
| navCube | Fungerar (OK) | Hanteras separat i AssetPlusViewer |
| minimap | Fungerar (OK) | Hanteras separat i AssetPlusViewer |
| treeView | Fungerar (OK) | Hanteras separat |
| visualization | Fungerar (OK) | RoomVisualizationPanel hanterar |
| objectInfo | Fungerar (OK) | Asset+ dialog |
| properties | Fungerar (OK) | Lovable properties dialog |

### Overflow-meny (nar verktyg flyttas dit)

| Problem | Beskrivning |
|---------|-------------|
| X-ray i overflow | Saknas helt -- `getOverflowItems` har inget `case 'xray'` |
| Alla overflow-items | Blockas av samma `isProcessing`-las nar de anropas |

## Detaljerad fixplan

### Fix 1: Ta bort global `isProcessing`-las (ViewerToolbar.tsx)

**Rotorsak**: Rad 85 definierar `isProcessing` som en global boolean. Rad 354 (`handleToolChange`), 284 (`handleResetView`), 293 (`handleZoomIn`), 309 (`handleZoomOut`), 327 (`handleViewFit`), 343 (`handleNavModeChange`) -- ALLA kontrollerar `if (!isViewerReady || isProcessing) return;`. Nar nagon av dessa satter `isProcessing = true`, ar hela toolbaren last.

**Fix**:
- Ta bort `isProcessing`-state helt (rad 85)
- Ta bort 2-sekunders safety timeout (rad 132-144)
- Behall debounce ENBART i `handleToolChange` som en lokal `useRef` med 150ms cooldown -- detta ar det enda stallet dar `useTool()` kallas och dubbelklick kan orsaka problem
- Alla andra handlers (zoom, reset, nav mode, toggles) ska INTE ha nagon debounce

Andringar i detalj:
```typescript
// Ta bort rad 85:
// const [isProcessing, setIsProcessing] = useState(false);

// Lagg till istallet en ref for enbart tool-change:
const toolChangeDebounceRef = useRef(false);

// handleToolChange -- enda stallet med debounce:
const handleToolChange = useCallback((tool: ViewerTool) => {
  if (!isViewerReady || toolChangeDebounceRef.current) return;
  toolChangeDebounceRef.current = true;
  // ... tool change logic (behall befintlig logik)
  setTimeout(() => { toolChangeDebounceRef.current = false; }, 150);
}, [getAssetView, activeTool, isViewerReady]);

// ALLA andra handlers: ta bort isProcessing-check:
const handleZoomIn = useCallback(() => {
  if (!isViewerReady) return;
  // ... rest unchanged
}, [getXeokitViewer, isViewerReady]);
// Samma for: handleZoomOut, handleViewFit, handleResetView, handleNavModeChange
```

- Uppdatera `ToolButton`-komponenten (rad 559): ta bort `isProcessing` fran `isDisabled`

### Fix 2: Fixa hover highlight event-signatur (AssetPlusViewer.tsx)

**Rotorsak**: Rad 1811 definierar `handleMouseMove = (coords: number[])`, men `RoomVisualizationPanel.tsx` (rad 539) visar att xeokits `cameraControl.on('hover', ...)` skickar TVA argument: `(canvasCoords, hit)`. Alternativt kan det skicka ett event-objekt. For maximal kompatibilitet maste vi hantera bada formaten.

**Fix** (rad 1811 i AssetPlusViewer.tsx):
```typescript
const handleMouseMove = (coordsOrEvent: any) => {
  // Reset previous highlight
  if (lastHighlightedEntity) {
    try { lastHighlightedEntity.highlighted = false; } catch (e) {}
    lastHighlightedEntity = null;
  }

  // Handle both event object format and raw coords
  const canvasPos = coordsOrEvent?.canvasPos || coordsOrEvent;
  if (!canvasPos || !Array.isArray(canvasPos)) return;

  const hit = xeokitViewer.scene.pick({
    canvasPos,
    pickSurface: false,
  });

  if (hit?.entity) {
    hit.entity.highlighted = true;
    lastHighlightedEntity = hit.entity;
  }
};
```

### Fix 3: Implementera X-ray toggle (ViewerToolbar.tsx + ViewerRightPanel.tsx + VisualizationToolbar.tsx)

**Rotorsak**: `ToolbarSettings.tsx` definierar `{ id: 'xray', label: 'X-ray lage' }` som ett visualiseringsverktyg, men ingen UI-komponent renderar det. `AssetPlusViewer.tsx` har `changeXrayMaterial()` som konfigurerar x-ray-utseendet, men ingen toggle som aktiverar/avaktiverar det.

**Fix -- Lagg till i tre stallen**:

**a) ViewerRightPanel.tsx** -- Lagg till X-ray Switch i Display-sektionen (efter "Visa rum"):
```typescript
{isToolVisible('xray') && (
  <div className="flex items-center justify-between py-1.5">
    <div className="flex items-center gap-2">
      <div className={cn("p-1.5 rounded-md", xrayEnabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
        <Box className="h-4 w-4" />
      </div>
      <span className="text-sm">X-ray</span>
    </div>
    <Switch checked={xrayEnabled} onCheckedChange={handleToggleXray} />
  </div>
)}
```

Lagg till state och handler:
```typescript
const [xrayEnabled, setXrayEnabled] = useState(false);

const handleToggleXray = useCallback((enabled: boolean) => {
  setXrayEnabled(enabled);
  const xeokitViewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  if (xeokitViewer?.scene) {
    const objectIds = xeokitViewer.scene.objectIds || [];
    xeokitViewer.scene.setObjectsXRayed(objectIds, enabled);
  }
}, [viewerRef]);
```

**b) VisualizationToolbar.tsx** -- Lagg till i "Visa"-sektionen:
Samma Switch som ovan, anpassat till VisualizationToolbar-styling.

**c) ViewerToolbar.tsx** -- Lagg till `case 'xray'` i `getOverflowItems`:
```typescript
case 'xray':
  items.push({
    id: tool.id,
    label: 'X-ray lage',
    icon: <Box className="h-4 w-4" />,
    onClick: () => {
      const viewer = getXeokitViewer();
      if (viewer?.scene) {
        const ids = viewer.scene.objectIds || [];
        const currentlyXrayed = viewer.scene.xrayedObjectIds?.length > 0;
        viewer.scene.setObjectsXRayed(ids, !currentlyXrayed);
      }
    },
    active: (() => {
      const viewer = getXeokitViewer();
      return (viewer?.scene?.xrayedObjectIds?.length || 0) > 0;
    })()
  });
  break;
```

## Filer som andras

| Fil | Andring |
|-----|--------|
| `src/components/viewer/ViewerToolbar.tsx` | Ta bort global `isProcessing`, infor per-tool debounce ref, lagg till xray i overflow |
| `src/components/viewer/AssetPlusViewer.tsx` | Fixa hover event-signatur i `setupHoverHighlight` |
| `src/components/viewer/ViewerRightPanel.tsx` | Lagg till X-ray toggle i Display-sektionen |
| `src/components/viewer/VisualizationToolbar.tsx` | Lagg till X-ray toggle i Visa-sektionen |

## Forvantad effekt

- **Alla knappar** (orbit, zoom, reset, select, measure, slicer, flash, hover) svarar direkt vid klick -- ingen mer "varannan gang"-problem
- **Hover highlight** visar ratt entity-highlight nar musen ror sig over objekt
- **X-ray** fungerar som toggle i bade hogerpanelen, visualiseringsmenyn och overflowmenyn
- **Overflow-meny** fungerar for samtliga verktyg inklusive X-ray

