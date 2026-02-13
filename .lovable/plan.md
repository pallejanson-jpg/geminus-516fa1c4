
# Plan: Fixa mobil våningsvisning + 360 SDK-laddning

## Problem 1: IfcCovering-objekt doljs inte pa mobil

**Orsak:** Nar en enskild vaning valjs pa mobil (`handleMobileFloorToggle` i AssetPlusViewer.tsx, rad 2280-2329) togglas synligheten via `toggleHierarchy`, men IfcCovering-objekt (undertak) doljs INTE. Desktop-versionen (`FloorVisibilitySelector.tsx`, rad 374-385) har en extra loop som explicit döljer alla IfcCovering-objekt i solo-lage. Denna logik saknas helt pa mobil.

**Losning:** Lagg till IfcCovering-dolj-logik i `handleMobileFloorToggle` efter `toggleHierarchy`-anropet.

**Fil:** `src/components/viewer/AssetPlusViewer.tsx`

I `handleMobileFloorToggle` (rad 2302-2303), efter `toggleHierarchy(floorId, visible)`, lagg till:

```typescript
// After toggleHierarchy — hide IfcCovering in solo mode
// (matches desktop FloorVisibilitySelector behavior)
const updatedFloors = mobileFloors.map(f =>
  f.id === floorId ? { ...f, visible } : f
);
const visibleCount = updatedFloors.filter(f => f.visible).length;
const isSoloMode = visibleCount === 1;

if (isSoloMode) {
  const metaObjects = metaScene.metaObjects || {};
  Object.values(metaObjects).forEach((metaObj: any) => {
    if (metaObj.type?.toLowerCase() === 'ifccovering') {
      const entity = scene.objects?.[metaObj.id];
      if (entity) {
        entity.visible = false;
      }
    }
  });
}
```

Dessutom maste desktop-logiken ocksa anvanda batch-metoden (`scene.setObjectsVisible`) for battre prestanda pa mobil. Nuvarande implementation itererar objekt ett och ett, vilket ar langsammare.

---

## Problem 2: 360 SDK laddar inte pa mobil

**Orsak:** Pa mobil renderar `MobileUnifiedViewer` (UnifiedViewer.tsx rad 536) `Ivion360View` direkt. Ivion360View har sin EGNA SDK-laddningslogik (rad 146-207) som:
1. Skapar en `<ivion>`-element vid mount (rad 132-144)
2. Laddar SDK:n i en separat useEffect (rad 147-207)

Problemet ar att `activePanel` vaxlar mellan `'3d'` och `'360'`, och React UNMOUNTAR 3D-viewern och MOUNTAR 360-viewern (rad 526-544). Varje gang 360 mountas kors SDK-laddningen pa nytt, men `activeLoadPromise`-guarden i `ivion-sdk.ts` (rad 196-206) kan blocka om en tidigare instans fortfarande ar igangsa. Dessutom kan `<ivion>`-elementet fa noll-dimensioner om containern inte ar redo.

**Losning:** Anvand den delade `useIvionSdk`-hooken fran `UnifiedViewerContent` (som redan ar aktiv pa desktop) aven for mobil. Skicka `ivApiRef` och `sdkContainerRef` till `MobileUnifiedViewer` och rendera SDK-containern och Ivion360View SAMTIDIGT (med display-styling) istallet for att montera/avmontera.

**Andringar i `src/pages/UnifiedViewer.tsx`:**

### MobileUnifiedViewer-layout (rad 525-547):
Istallet for att villkorligt rendera antingen AssetPlusViewer eller Ivion360View, rendera bada men visa/dolj med display:

```typescript
<div className="flex-1 min-h-0 relative">
  {/* 3D viewer — always mounted, hidden when 360 active */}
  <div style={{ display: activePanel === '3d' ? 'block' : 'none', height: '100%' }}>
    <AssetPlusViewer ... />
  </div>

  {/* 360 SDK container — always mounted if hasIvion */}
  {hasIvion && (
    <div
      ref={sdkContainerRef}
      style={{
        display: activePanel === '360' ? 'block' : 'none',
        position: 'absolute', inset: 0, height: '100%',
      }}
    />
  )}
</div>
```

Detta innebar att:
- SDK-containern alltid ar monterad (inte avmonterad/atermontera vid varje toggle)
- `useIvionSdk`-hooken i foraldern hanterar laddning, precis som pa desktop
- Ivion360View anvands INTE pa mobil langre — SDK:n renderar direkt i containern

---

## Sammanfattning av filandringar

```
src/components/viewer/AssetPlusViewer.tsx:
  - handleMobileFloorToggle: Lagg till IfcCovering-dolj-logik i solo-lage
    (efter rad 2302, ca 15 rader ny kod)

src/pages/UnifiedViewer.tsx:
  - MobileUnifiedViewer: Byt fran mount/unmount till display-styling
  - Skicka sdkContainerRef till MobileUnifiedViewer
  - Rendera SDK-container och 3D-viewer parallellt
```

## Forvantat resultat

- **Mobil vaningsval:** IfcCovering-objekt (undertak) doljs nar en enskild vaning isoleras, precis som pa desktop
- **360 SDK:** Laddar korrekt pa mobil eftersom containern alltid ar monterad och SDK:n inte behover laddas om vid varje toggle
