

# Plan: Fixa 2D-klippning & Lägg till Rumsetiketter

## Sammanfattning

Användaren vill:
1. **Fixa 2D-klippning** med slider för klipphöjd (standard 1.2m) - har aldrig fungerat
2. **Lägg till rumsetiketter** som visar rumsnummer och rumsnamn med en slider i viewer settings

---

## Del 1: Fixa 2D-klippning

### Problemanalys

Efter att ha analyserat koden i `useSectionPlaneClipping.ts` och xeokit API-dokumentationen hittade jag grundorsaken:

**Nuvarande kod (rad 74-91):**
```typescript
const SectionPlanesPlugin = (window as any).SectionPlanesPlugin;

if (!SectionPlanesPlugin) {
  console.debug('SectionPlanesPlugin not available globally');
  return null;
}
```

**Problemet:** `SectionPlanesPlugin` är inte tillgänglig som global variabel eftersom Asset+ viewer-paketet inte exporterar xeokit-plugins globalt. Fallback-koden försöker använda `viewer.scene.SectionPlane` men detta konstruktor-anrop fungerar inte heller.

### Lösning: Direkt Scene API

xeokit-scenen har en inbyggd `sectionPlanes`-manager som tillåter skapande av klippplan utan plugin. Enligt xeokit-dokumentationen:

```javascript
// Skapa section plane direkt på scenen
const sectionPlane = viewer.scene.sectionPlanes.create({
  id: "myPlane",
  pos: [0, 1.2, 0],
  dir: [0, 1, 0]
});
```

### Ändringar i `useSectionPlaneClipping.ts`

**Fil:** `src/hooks/useSectionPlaneClipping.ts`

1. **Ersätt plugin-initieringen** med direkt scene API:

```typescript
// Ny metod för att skapa section plane via scene API
const createSectionPlaneViaScene = useCallback((
  viewer: any,
  id: string,
  pos: [number, number, number],
  dir: [number, number, number]
) => {
  const scene = viewer.scene;
  if (!scene) return null;

  // Ta bort existerande plane med samma prefix
  Object.keys(scene.sectionPlanes || {}).forEach(planeId => {
    if (planeId.startsWith('floor-clip-')) {
      scene.sectionPlanes[planeId].destroy?.();
    }
  });

  // Skapa nytt section plane
  // OBS: xeokit SectionPlane klipper i 'dir'-riktningen
  // För 2D planritning: dir [0, 1, 0] = allt ÖVER planet klipps bort
  const SectionPlane = scene.SectionPlane;
  if (SectionPlane) {
    return new SectionPlane(scene, { id, pos, dir, active: true });
  }

  // Alternativ: Använd scene.addSectionPlane om tillgängligt
  if (typeof scene.addSectionPlane === 'function') {
    return scene.addSectionPlane({ id, pos, dir, active: true });
  }

  return null;
}, []);
```

2. **Uppdatera `applySectionPlane`** för att använda den nya metoden:

```typescript
const applySectionPlane = useCallback((floorId: string, mode?: ClipMode) => {
  const viewer = getXeokitViewer();
  if (!viewer?.scene) return;

  const effectiveMode = mode || clipMode;
  const floorCutHeight = floorCutHeightRef.current;

  // Beräkna klipphöjd
  let clipHeight: number;
  if (effectiveMode === 'floor') {
    const bounds = calculateFloorBounds(floorId);
    if (!bounds) return;
    clipHeight = bounds.minY + floorCutHeight;
  } else {
    const boundaryHeight = calculateClipHeightFromFloorBoundary(floorId);
    if (!boundaryHeight) return;
    clipHeight = boundaryHeight;
  }

  // Riktning: [0, 1, 0] för 2D (klipp ovan), [0, -1, 0] för 3D tak
  const dir: [number, number, number] = effectiveMode === 'floor' 
    ? [0, 1, 0] 
    : [0, -1, 0];

  // Skapa section plane
  sectionPlaneRef.current = createSectionPlaneViaScene(
    viewer,
    `floor-clip-${floorId}-${effectiveMode}`,
    [0, clipHeight, 0],
    dir
  );

  if (sectionPlaneRef.current) {
    console.log(`✅ Section plane skapat vid Y=${clipHeight.toFixed(2)}m (${effectiveMode})`);
  }
}, [...]);
```

3. **Säkerställ att klipphöjdslidern triggar korrekt:**

Slidern i `VisualizationToolbar.tsx` (rad 711-718) emittar redan `CLIP_HEIGHT_CHANGED_EVENT`. Kontrollera att listenern i `ViewerToolbar.tsx` anropar `updateFloorCutHeight` korrekt.

---

## Del 2: Lägg till Rumsetiketter

### Teknisk Lösning

Baserat på xeokit:s `Marker`-API kan vi skapa HTML-labels som följer rumspositioner i 3D.

**Strategi:**
1. För varje `IfcSpace` i scenen, skapa en `Marker` vid rummets centrum
2. Lyssna på `canvasPos`-uppdateringar för att positionera HTML-labels
3. Toggle via slider i Viewer Settings

### Ny Hook: `useRoomLabels.ts`

**Fil:** `src/hooks/useRoomLabels.ts`

```typescript
import { useRef, useCallback, useEffect } from 'react';

interface RoomLabel {
  fmGuid: string;
  name: string;
  number: string;
  marker: any; // xeokit Marker
  element: HTMLDivElement;
}

export const ROOM_LABELS_TOGGLE_EVENT = 'ROOM_LABELS_TOGGLE';

export function useRoomLabels(viewerRef: React.MutableRefObject<any>) {
  const labelsRef = useRef<Map<string, RoomLabel>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const enabledRef = useRef(false);

  const getXeokitViewer = useCallback(() => {
    return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  }, [viewerRef]);

  // Skapa label-container
  const ensureContainer = useCallback(() => {
    if (containerRef.current) return containerRef.current;

    const canvas = getXeokitViewer()?.scene?.canvas?.canvas;
    if (!canvas?.parentElement) return null;

    const container = document.createElement('div');
    container.id = 'room-labels-container';
    container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: hidden;
      z-index: 10;
    `;
    canvas.parentElement.appendChild(container);
    containerRef.current = container;
    return container;
  }, [getXeokitViewer]);

  // Skapa labels för alla rum
  const createLabels = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects || !viewer?.scene) return;

    const container = ensureContainer();
    if (!container) return;

    const metaObjects = viewer.metaScene.metaObjects;
    const scene = viewer.scene;
    const Marker = (window as any).xeokit?.Marker || viewer.scene.Marker;

    Object.values(metaObjects).forEach((metaObj: any) => {
      if (metaObj.type?.toLowerCase() !== 'ifcspace') return;

      const entity = scene.objects?.[metaObj.id];
      if (!entity?.aabb) return;

      // Beräkna centrum
      const aabb = entity.aabb;
      const center = [
        (aabb[0] + aabb[3]) / 2,
        (aabb[1] + aabb[4]) / 2,
        (aabb[2] + aabb[5]) / 2,
      ];

      // Hämta rumsinfo
      const fmGuid = metaObj.originalSystemId || metaObj.id;
      const name = metaObj.name || '';
      const number = metaObj.attributes?.LongName || 
                     metaObj.propertySetValues?.Pset_SpaceCommon?.Reference || 
                     '';

      // Skapa HTML-label
      const labelEl = document.createElement('div');
      labelEl.className = 'room-label';
      labelEl.innerHTML = `
        <div class="room-label-number">${number || '—'}</div>
        <div class="room-label-name">${name}</div>
      `;
      labelEl.style.cssText = `
        position: absolute;
        background: rgba(0, 0, 0, 0.75);
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        line-height: 1.3;
        text-align: center;
        transform: translate(-50%, -50%);
        white-space: nowrap;
        pointer-events: none;
      `;
      container.appendChild(labelEl);

      // Skapa Marker för position-tracking
      const marker = new Marker(viewer.scene, {
        worldPos: center,
        occludable: false, // Visa alltid (även bakom geometri)
      });

      // Uppdatera label-position när kameran rör sig
      marker.on('canvasPos', (canvasPos: number[]) => {
        labelEl.style.left = `${canvasPos[0]}px`;
        labelEl.style.top = `${canvasPos[1]}px`;
      });

      marker.on('visible', (visible: boolean) => {
        labelEl.style.display = visible ? 'block' : 'none';
      });

      labelsRef.current.set(fmGuid, { fmGuid, name, number, marker, element: labelEl });
    });

    console.log(`✅ Created ${labelsRef.current.size} room labels`);
  }, [getXeokitViewer, ensureContainer]);

  // Ta bort alla labels
  const destroyLabels = useCallback(() => {
    labelsRef.current.forEach(label => {
      label.marker.destroy?.();
      label.element.remove();
    });
    labelsRef.current.clear();
    console.log('Room labels destroyed');
  }, []);

  // Toggle labels
  const setLabelsEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;

    if (enabled) {
      createLabels();
    } else {
      destroyLabels();
    }

    // Visa/dölj container
    if (containerRef.current) {
      containerRef.current.style.display = enabled ? 'block' : 'none';
    }
  }, [createLabels, destroyLabels]);

  // Cleanup
  useEffect(() => {
    return () => {
      destroyLabels();
      containerRef.current?.remove();
    };
  }, [destroyLabels]);

  return {
    setLabelsEnabled,
    isEnabled: enabledRef.current,
    labelCount: labelsRef.current.size,
  };
}
```

### UI-kontroll i VisualizationToolbar

**Fil:** `src/components/viewer/VisualizationToolbar.tsx`

Lägg till ny switch i Viewer Settings-sektionen:

```tsx
// State
const [showRoomLabels, setShowRoomLabels] = useState(false);

// I Viewer Settings collapsible (efter Klipphöjd-slidern):
<div className="flex items-center justify-between py-1.5 sm:py-2">
  <div className="flex items-center gap-2 sm:gap-3">
    <div className={cn(
      "p-1 sm:p-1.5 rounded-md",
      showRoomLabels ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
    )}>
      <Type className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
    </div>
    <span className="text-xs sm:text-sm">Rumsetiketter</span>
  </div>
  <Switch 
    checked={showRoomLabels} 
    onCheckedChange={(checked) => {
      setShowRoomLabels(checked);
      window.dispatchEvent(new CustomEvent(ROOM_LABELS_TOGGLE_EVENT, {
        detail: { enabled: checked }
      }));
    }} 
  />
</div>
```

### Integration i AssetPlusViewer

**Fil:** `src/components/viewer/AssetPlusViewer.tsx`

```tsx
import { useRoomLabels, ROOM_LABELS_TOGGLE_EVENT } from '@/hooks/useRoomLabels';

// I komponenten:
const { setLabelsEnabled } = useRoomLabels(viewerInstanceRef);

// Lyssna på toggle-event
useEffect(() => {
  const handleToggle = (e: CustomEvent) => {
    setLabelsEnabled(e.detail.enabled);
  };
  window.addEventListener(ROOM_LABELS_TOGGLE_EVENT, handleToggle as EventListener);
  return () => {
    window.removeEventListener(ROOM_LABELS_TOGGLE_EVENT, handleToggle as EventListener);
  };
}, [setLabelsEnabled]);
```

---

## Filer som Påverkas

| Fil | Ändringar |
|-----|-----------|
| `src/hooks/useSectionPlaneClipping.ts` | Fixa section plane-skapande med direkt scene API |
| `src/hooks/useRoomLabels.ts` | **NY FIL** - Hook för rumsetiketter med xeokit Marker |
| `src/components/viewer/VisualizationToolbar.tsx` | Lägg till Rumsetiketter-toggle i Viewer Settings |
| `src/components/viewer/AssetPlusViewer.tsx` | Integrera useRoomLabels hook |

---

## Teknisk Sammanfattning

```text
┌────────────────────────────────────────────────────────────────┐
│                    2D KLIPPNING (FIXAD)                        │
├────────────────────────────────────────────────────────────────┤
│  1. Användare togglar 2D i VisualizationToolbar                │
│  2. VIEW_MODE_REQUESTED_EVENT → ViewerToolbar                  │
│  3. handleViewModeChange('2d') anropas                         │
│  4. applyFloorPlanClipping() i useSectionPlaneClipping         │
│  5. Section plane skapas via scene.sectionPlanes               │
│  6. Geometri klipps vid floorMinY + clipHeight (1.2m)          │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│                    RUMSETIKETTER (NY)                          │
├────────────────────────────────────────────────────────────────┤
│  1. Användare aktiverar "Rumsetiketter" i Viewer Settings      │
│  2. ROOM_LABELS_TOGGLE_EVENT dispatches                        │
│  3. useRoomLabels.setLabelsEnabled(true)                       │
│  4. För varje IfcSpace:                                        │
│     - Beräkna centrum från aabb                                │
│     - Skapa xeokit Marker vid worldPos                         │
│     - Skapa HTML-label div                                     │
│     - Lyssna på canvasPos för positionering                    │
│  5. Labels visas som overlay på canvas                         │
└────────────────────────────────────────────────────────────────┘
```

---

## Fallback-strategier

### Om xeokit Marker inte finns:

Använd alternativ approach med direkt canvas-projektion:

```typescript
// Projicera 3D-punkt till 2D canvas
const worldToCanvas = (worldPos: number[], camera: any, canvas: HTMLCanvasElement) => {
  const viewMatrix = camera.viewMatrix;
  const projMatrix = camera.projMatrix;
  // ... matris-multiplikation ...
  return [canvasX, canvasY];
};

// Uppdatera alla labels på varje frame
viewer.scene.on('tick', () => {
  labelsRef.current.forEach(label => {
    const canvasPos = worldToCanvas(label.worldPos, viewer.camera, canvas);
    label.element.style.left = `${canvasPos[0]}px`;
    label.element.style.top = `${canvasPos[1]}px`;
  });
});
```

### Om Section Plane fortfarande inte fungerar:

Asset+ viewer-paketet kan ha egen clipping-hantering. Kontrollera:
1. `assetViewer.setShowFloorplan(true)` - kan aktivera inbyggd 2D-vy
2. `assetViewer.cutOutFloorByFmGuid(floorFmGuid)` - kan ge liknande effekt

---

## Verifiering

1. **2D-klippning:**
   - Öppna 3D-viewer
   - Välj ett våningsplan
   - Toggla "2D" i VisualizationToolbar
   - Verifiera att geometri klipps horisontellt
   - Ändra klipphöjd med slider (0.5-2.5m)
   - Verifiera att klippnivån uppdateras i realtid

2. **Rumsetiketter:**
   - Öppna 3D-viewer
   - Gå till Viewer Settings
   - Aktivera "Rumsetiketter"
   - Verifiera att labels visas vid rumscentrum
   - Navigera kameran och verifiera att labels följer
   - Inaktivera och verifiera att labels försvinner

