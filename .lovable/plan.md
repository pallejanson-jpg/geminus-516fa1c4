

## Fix: GUID-matchning mellan Insights och 3D-viewern

### Rotorsak

ColorMap-nycklarna ar **FM GUIDs** (UUID-format, t.ex. `755950d9-f235-...`) fran Asset+-databasen, men matchningen pa rad 351 jamfor mot `mo.originalSystemId || mo.id` som ar **IFC GlobalIds** (22 tecken, base64-format, t.ex. `3vB2Yv0qX7uhTQKK...`). De matchar aldrig -- darfor hittas inga objekt att farga.

Losningen ar att anvanda Asset+-viewerns inbyggda `getItemsByPropertyValue("fmguid", floorGuid)` -- exakt samma metod som redan fungerar for `asset_categories`-laget (rad 390).

### Fil: `src/components/viewer/AssetPlusViewer.tsx`

**Rad 342-374: Byt GUID-matchningen fran metaObject-traversering till `getItemsByPropertyValue`**

Byt fran:
```typescript
Object.entries(colorMap).forEach(([floorGuid, rgb]) => {
  const guidLower = floorGuid.toLowerCase();
  let spaceIds = spacesByFloorCacheRef.current.get(guidLower) || [];
  if (spaceIds.length === 0) {
    const foundIds: string[] = [];
    Object.values(metaObjects).forEach((mo: any) => {
      if (mo.type?.toLowerCase() !== 'ifcbuildingstorey') return;
      const moGuid = (mo.originalSystemId || mo.id || '').toLowerCase();
      if (moGuid !== guidLower) return;
      // ... traverse children
    });
    spaceIds = foundIds;
  }
  // colorize spaceIds...
});
```

Till:
```typescript
Object.entries(colorMap).forEach(([floorGuid, rgb]) => {
  const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;
  if (!assetView) return;

  // Step 1: Find the storey's xeokit entity ID via Asset+'s FM GUID lookup
  const storeyItemIds = assetView.getItemsByPropertyValue("fmguid", floorGuid.toUpperCase()) || [];
  console.log('[Insights] Floor', floorGuid, '-> storeyItemIds:', storeyItemIds.length);

  // Step 2: For each storey entity, find ALL children in the metaObject tree
  const allChildIds: string[] = [];
  storeyItemIds.forEach((itemId: string) => {
    const mo = metaObjects[itemId];
    if (!mo) return;
    const findChildren = (parent: any) => {
      if (!parent.children) return;
      parent.children.forEach((child: any) => {
        allChildIds.push(child.id);
        findChildren(child);
      });
    };
    findChildren(mo);
    // Also include the storey entity itself
    allChildIds.push(itemId);
  });

  console.log('[Insights] Floor', floorGuid, '-> total children:', allChildIds.length);

  // Step 3: Un-xray and colorize all children
  allChildIds.forEach(id => {
    const entity = scene.objects?.[id];
    if (entity) {
      entity.xrayed = false;
      entity.visible = true;
      entity.colorize = rgb;
      entity.opacity = 0.85;
    }
  });
});
```

### Sammanfattning

| Fil | Andring |
|-----|---------|
| `AssetPlusViewer.tsx` | Byt fran `originalSystemId`-matchning till `getItemsByPropertyValue("fmguid", ...)` for `energy_floors`-laget |

### Varfor det fungerar

`getItemsByPropertyValue("fmguid", ...)` ar Asset+-viewerns egna soksystem som vet hur FM GUIDs kopplar till xeokit-entiteter. Det ar samma metod som redan fungerar for `asset_categories`-laget. Genom att forst hitta vanningens xeokit-ID och sedan traversera dess barn i metaObject-tradet, far vi tag pa alla objekt (vaggar, dorrar, fonster etc.) som tillhor vaningen.

