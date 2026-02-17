

## Plan: Forbattra rumsetiketter i 3D-viewern

Fem forbattringar av rumslabell-systemet baserat pa dina onskemal.

### 1. Ocklusionstest -- dolj etiketter bakom vaggar/tak

Lagg till ett djuptest (occlusion check) som jamfor etikettens djupvarde mot scenens depth buffer. Om nagot objekt (vagg, tak) ar narmare kameran an etiketten doljs den.

**Teknik:** Anvand xeokit-viewerns `scene.pick()` med en ray fran kameran till etikettens 3D-position. Om pick-resultatet traffar ett annat objekt an rummets entity (och det traffade objektet ar narmare) doljs etiketten.

**Implementering i `useRoomLabels.ts`, `updateLabelPositions`:**
- For varje etikett: gor en enkel siktlinjetest med `scene.pick({ pickSurface: false, origin: cameraEye, direction: normalized(labelPos - cameraEye) })`
- Om det traffade objektets entity-id inte matchar etikettens entityId OCH traffpunkten ar narmare an etiketten -- satt `display: none`
- Optimering: kors ocklusionstest max var 5:e frame (throttle) for att inte paverka prestanda

### 2. Sank hojden till golvnivaet

Andra default `heightOffset` fran `1.2` till `0.0` (eller nara `0.05` for att undvika z-fighting). I `createLabels` anvands `aabb[1]` (botten av rummets bounding box) plus offset -- med offset 0 hamnar etiketten vid golvniva.

**Andringar:**
- `useRoomLabels.ts` rad 29: Andra `heightOffset: 1.2` till `heightOffset: 0.05`
- `RoomLabelSettings.tsx`: Andra slider min-varde fran `0.1` till `0.0` och default fran `1.2` till `0.05`

### 3. Minska etikettens bakgrundsstorlek men behall textstorlek

Minska padding fran `3px 6px` till `1px 3px`, ta bort eller minimera border och box-shadow, och gor bakgrunden mer transparent. Textstorleken paverkas inte.

**Andringar i `createLabels`, `labelEl.style.cssText`:**
- Andra `padding: 3px 6px` till `padding: 1px 3px`
- Andra `border-radius: 4px` till `border-radius: 2px`
- Minska `box-shadow` till `0 0 2px rgba(0,0,0,0.1)`
- Gor bakgrunden mer transparent: `background: hsl(var(--background) / 0.6)`

### 4. Lagg etiketten platt pa golvet (billboard till plan)

Istallet for att alltid vara vand mot kameran (billboard-stil) kan etiketten renderas som en CSS-transformerad yta som ligger plant pa golvet. Detta kravs en perspektiv-rotation.

**Teknik:** Istallet for att anvanda `translate(-50%, -50%)` som billboard laggs en CSS 3D-rotation till som matchar golvplanet:
- Berakna etikettens rotation fran kamerans vy sa att den framstar som liggande plant i 3D-rymden
- Anvand `transform: translate3d(...) rotateX(90deg)` justerat med kamerans projektion
- Alternativt: anvand xeokits egna sprite/label-system om det stodjer plan-orientering

**Forenklad losning:** Lagg till ett `flat`-lage dar etiketten far en extra `rotateX()`-transform baserad pa kamerans pitch-vinkel, sa att den visuellt "ligger ner" pa golvet. Nar kameran ar rakt ovanifran (planvy) ser den normal ut, och fran sidan ser den perspektiviskt platt ut.

### 5. Lagg till nya konfigurationsalternativ i RoomLabelSettings

Lagg till tva nya installningar i konfigurationsinterfacet:

- **Ocklusion (on/off):** Switch for att aktivera/avaktivera ocklusionstest (default: pa)
- **Platt lage (on/off):** Switch for att lagga etiketter plant pa golvet istallet for billboard-stil (default: av)

### Tekniska detaljer

**Filer som andras:**

| Fil | Andring |
|-----|---------|
| `src/hooks/useRoomLabels.ts` | Lagg till ocklusionstest i `updateLabelPositions`, sank default hojd, minska padding, lagg till flat-transform |
| `src/hooks/useRoomLabelConfigs.ts` | Lagg till `occlusion_enabled` och `flat_on_floor` i `RoomLabelConfig` interface |
| `src/components/settings/RoomLabelSettings.tsx` | Lagg till switchar for ocklusion och platt-lage, uppdatera slider-defaults |

**Databasandring:** Lagg till tva nya kolumner i `room_label_configs`-tabellen:
- `occlusion_enabled BOOLEAN DEFAULT true`
- `flat_on_floor BOOLEAN DEFAULT false`

**Uppdaterat RoomLabelsConfigDetail:**
```typescript
export interface RoomLabelsConfigDetail {
  fields: string[];
  heightOffset: number;
  fontSize: number;
  scaleWithDistance: boolean;
  clickAction: 'none' | 'flyto' | 'roomcard';
  occlusionEnabled: boolean;   // ny
  flatOnFloor: boolean;        // ny
}
```

**Ocklusionslogik (pseudokod):**
```typescript
// I updateLabelPositions, for varje etikett:
if (config.occlusionEnabled) {
  const dir = normalize(subtract(label.worldPos, cameraEye));
  const pickResult = viewer.scene.pick({
    origin: cameraEye,
    direction: dir,
    pickSurface: false,
  });
  if (pickResult?.entity && pickResult.entity.id !== label.entityId) {
    // Nagot annat objekt blockerar sikten
    visible = false;
  }
}
```

**Flat-transform (pseudokod):**
```typescript
// I updateLabelPositions, for varje etikett:
if (config.flatOnFloor) {
  // Berakna pitch fran kamerans eye/look
  const pitch = Math.atan2(
    cameraEye[1] - cameraLook[1],
    horizontalDist
  );
  const tiltDeg = 90 - (pitch * 180 / Math.PI);
  transform += ` rotateX(${tiltDeg}deg)`;
}
```

### Prestanda

- Ocklusionstest med `scene.pick()` kan vara tungt for manga etiketter. Begransning: max 1 pick per etikett per 5 frames, och skippa etiketter som ar utanfor synfaltet
- Flat-transform ar en ren CSS-operation och paverkar inte prestanda

