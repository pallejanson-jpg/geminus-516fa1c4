

# Plan: Native Xeokit i alla lägen + korrekt IFC-färgläggning

## Problem 1: Native Xeokit saknas i vissa lägen

`shouldUseNative3D` på rad 452 i `UnifiedViewer.tsx` täcker bara `3d`, `2d`, `split`. Lägena `vt`, `split2d3d` faller igenom till legacy `AssetPlusViewer`.

**Fix**: Ändra till `const shouldUseNative3D = true` — alla lägen ska använda Native Xeokit. Behåll `needs3D` (styr container-visibility) som den är.

## Problem 2: Fönster är blåa, rum är röda

Native Xeokit visar rå XKT-materialfärger som inte matchar förväntad IFC-typ-styling. `useArchitectViewMode` har redan en komplett IFC-typ-till-färg-mappning som ger korrekta färger (väggar → beige, dörrar → gröna, fönster → blågrå, rum → ljusgrå, etc).

**Fix**: I `NativeXeokitViewer.tsx`, efter modell-laddning (rad 510-537), applicera IFC-typ-baserad färgläggning på alla objekt — samma färgschema som `useArchitectViewMode` använder. Detta gör att:
- Fönster får rätt blågrå ton istället av knallblå
- Rum (IfcSpace) får ljusgrå istället av rött, plus behåller opacity 0.3 och hidden
- Väggar, dörrar, tak, golv etc. får arkitektoniska toner

## Ändringar

### 1. `src/pages/UnifiedViewer.tsx` (rad 452)
```ts
// Före:
const shouldUseNative3D = viewMode === '3d' || viewMode === '2d' || viewMode === 'split';
// Efter:
const shouldUseNative3D = true;
```

### 2. `src/components/viewer/NativeXeokitViewer.tsx` (rad 510-537)
Ersätt den befintliga post-load-logiken med IFC-typ-baserad färgläggning:
- Importera/definiera samma `IFC_TYPE_COLORS`-mappning som i `useArchitectViewMode`
- Iterera alla `metaObjects`, slå upp IFC-typ, applicera matchande färg via `entity.colorize`
- IfcSpace-objekt: applicera ljusgrå färg + opacity 0.3 + hidden + non-pickable (som idag men med rätt färg)
- Objekt utan matchad typ: behåll en neutral standardfärg

### 3. `vite.config.ts` — Cesium-alias
Lägg till `"cesium": "@cesium/engine"` i resolve.alias för att fixa resium-importen (detta var planerat men saknades i senaste bygget).

## Resultat
- Alla 6 lägen (2D, 3D, Split 2D/3D, Split 3D/360, VT, 360) använder Native Xeokit
- IFC-objekt visas med arkitektoniska, korrekta färger direkt vid laddning
- Rum (IfcSpace) visas aldrig i rött

