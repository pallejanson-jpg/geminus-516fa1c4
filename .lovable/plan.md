
# Plan: Förbättra ärende-panelens beteende

## Problem att lösa

1. **Ärendelistan stängs när Visningsmenyn stängs** - Den kontrolleras av `activeSubMenu` state som nollställs
2. **Ärendelistan positioneras inte bredvid Visningsmenyn** - Den positionerar sig oberoende i högra hörnet
3. **Objekt selekteras inte med flash vid öppning av ärende** - Flashen körs men objektet ska också vara visuellt selekterat i 3D

---

## Lösning

### Del 1: Oberoende state för ärendelistan

Ändra från `activeSubMenu === 'issues'` till en egen `showIssueList` state:

```typescript
// I VisualizationToolbar.tsx
const [showIssueList, setShowIssueList] = useState(false);

// Knappen "Visa ärenden"
<Button onClick={() => setShowIssueList(!showIssueList)}>
  Visa ärenden
</Button>

// FloatingIssueListPanel - nu oberoende av activeSubMenu
<FloatingIssueListPanel
  isOpen={showIssueList}
  onClose={() => setShowIssueList(false)}
  // ...
/>
```

Detta gör att ärendelistan förblir öppen även när huvudmenyn (VisualizationToolbar) stängs.

---

### Del 2: Positionera bredvid Visningsmenyn

Uppdatera `FloatingIssueListPanel` att ta emot `parentPosition` och `parentWidth`:

```typescript
interface FloatingIssueListPanelProps {
  // ... existing
  parentPosition?: { x: number; y: number };
  parentWidth?: number;
}

// Beräkna initial position till vänster om Visningsmenyn
useEffect(() => {
  if (isOpen) {
    const x = parentPosition 
      ? parentPosition.x - panelWidth - 10  // 10px gap
      : window.innerWidth - panelWidth - 20;
    
    setPosition({
      x: Math.max(10, x),
      y: parentPosition?.y ?? 80,
    });
  }
}, [isOpen, parentPosition, parentWidth]);
```

I `VisualizationToolbar`:
```typescript
<FloatingIssueListPanel
  parentPosition={position}
  parentWidth={panelWidth}
  // ...
/>
```

---

### Del 3: Selektera objekt med flash vid ärendeöppning

Uppdatera `handleGoToIssueViewpoint` för att säkerställa att:
1. Objekten selekteras i scenen (redan görs av `restoreViewpoint`)
2. Flash-effekten körs EFTER selektion för tydlighet

Nuvarande kod (fungerar delvis):
```typescript
const handleGoToIssueViewpoint = useCallback((viewpoint: any) => {
  restoreViewpoint(viewpoint, { duration: 1.0 });
  
  if (viewpoint.components?.selection?.length > 0) {
    const selectedIds = viewpoint.components.selection.map((s: any) => s.ifc_guid);
    setTimeout(() => {
      flashEntitiesByIds(xeokitViewer.scene, selectedIds, { duration: 3000 });
    }, 1100);
  }
}, [restoreViewpoint, flashEntitiesByIds]);
```

`restoreViewpoint` selekterar redan objekten (rad 201-207 i useBcfViewpoints.ts):
```typescript
if (viewpoint.components?.selection) {
  scene.setObjectsSelected(scene.selectedObjectIds, false);
  const idsToSelect = viewpoint.components.selection.map(s => s.ifc_guid);
  scene.setObjectsSelected(idsToSelect, true);  // Selekterar i 3D
}
```

Problemet kan vara:
- Objekten finns inte i scenen (fel ID-format)
- Våningsplanet objektet ligger på är inte synligt

**Lösning**: Säkerställ att objekten blir synliga innan selektion:

```typescript
const handleGoToIssueViewpoint = useCallback((viewpoint: any) => {
  restoreViewpoint(viewpoint, { duration: 1.0 });
  
  if (viewpoint.components?.selection?.length > 0) {
    const selectedIds = viewpoint.components.selection.map((s: any) => s.ifc_guid);
    const xeokitViewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    
    if (xeokitViewer?.scene) {
      const scene = xeokitViewer.scene;
      
      // Efter kamera-animation, säkerställ selektion + flash
      setTimeout(() => {
        // 1. Säkerställ objekten är synliga
        scene.setObjectsVisible(selectedIds, true);
        
        // 2. Selektera objekten (om inte redan gjort)
        scene.setObjectsSelected(selectedIds, true);
        
        // 3. Flash för visuell feedback
        flashEntitiesByIds(scene, selectedIds, { 
          duration: 3000,
          color1: [1, 0.2, 0.2],  // Röd
          color2: [1, 1, 1],      // Vit
        });
      }, 1100);
    }
  }
}, [restoreViewpoint, viewerRef, flashEntitiesByIds]);
```

---

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/components/viewer/VisualizationToolbar.tsx` | Lägg till `showIssueList` state, skicka `parentPosition` till panelen |
| `src/components/viewer/FloatingIssueListPanel.tsx` | Ta emot `parentPosition`, positionera till vänster om menyn |

---

## Teknisk detalj: Positionering

```text
┌──────────────────────┐   ┌────────────────────────┐
│                      │   │                        │
│   Ärendelistan       │   │   Visningsmenyn        │
│   (FloatingIssueList)│   │   (VisualizationToolbar)│
│                      │   │                        │
│   Draggbar           │ ← 10px gap →│   Draggbar   │
│                      │   │                        │
└──────────────────────┘   └────────────────────────┘
        x = parent.x - panelWidth - 10
```

---

## Testning

1. **Öppna ärendelistan** → Stäng Visningsmenyn → Ärendelistan ska förbli öppen
2. **Positionering** → Ärendelistan ska visas till vänster om Visningsmenyn
3. **Öppna ett ärende** → Kameran flyger till position → Objektet ska vara selekterat i 3D → Objektet ska blinka rött
4. **Dra ärendelistan** → Den ska kunna flyttas oberoende av Visningsmenyn
