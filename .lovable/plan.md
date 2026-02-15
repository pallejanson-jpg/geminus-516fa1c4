

## Fix: Insights energi-infargning -- farga ALLA objekt pa vaningen

### Problem

Koden i `AssetPlusViewer.tsx` (rad 353-356) filtrerar BARA pa `ifcspace` nar den traverserar vaningens barn:

```typescript
if (child.type?.toLowerCase() === 'ifcspace') foundIds.push(child.id);
```

Om vaningen inte har nagra IfcSpace-objekt i BIM-modellen, hittas inget att farga -- alltsa ingen synlig effekt.

### Losning

Samla ALLA objekt (alla typer) under vaningens `IfcBuildingStorey` i metaObject-tradet, inte bara `ifcspace`. Det ger vaningens vaggar, tak, dorrar, fonster etc. samma farg -- hela vaningen "lyser" i diagramfargen.

---

### Fil: `src/components/viewer/AssetPlusViewer.tsx`

**Rad 353-356: Ta bort IfcSpace-filtret i `findSpaces`**

Byt fran:
```typescript
const findSpaces = (parent: any) => {
  if (!parent.children) return;
  parent.children.forEach((child: any) => {
    if (child.type?.toLowerCase() === 'ifcspace') foundIds.push(child.id);
    findSpaces(child);
  });
};
```

Till:
```typescript
const findChildren = (parent: any) => {
  if (!parent.children) return;
  parent.children.forEach((child: any) => {
    foundIds.push(child.id);  // Collect ALL objects, not just spaces
    findChildren(child);
  });
};
```

Ocksa byt anropet fran `findSpaces(mo)` till `findChildren(mo)`.

---

### Sammanfattning

| Fil | Andring |
|-----|---------|
| `AssetPlusViewer.tsx` | Ta bort `ifcspace`-filtret i energy_floors-traverseringen sa ALLA objekt under vaningen fargas |

### Resultat

Alla objekt (vaggar, dorrar, fonster, golv, tak) pa en vaning fargas med diagramfargen fran Insights. Hela vaningen "lyser" mot den xray:ade byggnaden.

