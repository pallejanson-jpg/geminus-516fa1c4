

## Problem: sync-with-cleanup raderar IFC-extraherade storeys/spaces

### Rotorsak

`sync-with-cleanup` i `asset-plus-sync/index.ts` (rad 1594-1601):

1. Hämtar alla `remoteFmGuids` från Asset+ API
2. Hämtar alla lokala `is_local=false` structure-objekt (exkl. ACC-prefix)  
3. Raderar lokala objekt som inte finns i Asset+ ("orphans")

Byggnaden SV:s storeys/spaces skapas från IFC-metadata via `ifc-extract-systems` — de har `is_local=false` men existerar INTE i Asset+. Resultatet: de raderas vid varje synk.

### Plan

#### 1. Skydda IFC-extraherade objekt från orphan-cleanup

**Fil**: `supabase/functions/asset-plus-sync/index.ts` (rad ~1594-1601)

Lägg till logik som exkluderar byggnader som inte finns i Asset+ (dvs som bara har IFC-importerad data). Två alternativ:

**Alt A — Markera med source-kolumn**: Lägg till en `source` text-kolumn på `assets`-tabellen (default `'assetplus'`, IFC-extraherade sätts till `'ifc'`). `fetchAllLocalFmGuids` filtrerar bort `source = 'ifc'` vid orphan-check.

**Alt B — Enklare: kolla om byggnaden finns i remoteFmGuids**: Om en storey/space tillhör en `building_fm_guid` som inte finns i `remoteFmGuids`, skippa den i orphan-listan. Detta skyddar alla lokala byggnader som inte synkats från Asset+.

**Rekommendation**: Alt B — kräver ingen DB-migration, bara en kodändring i orphan-filtret.

```text
Nuvarande logik:
  orphans = localGuids.filter(g => !remoteFmGuids.has(g))

Ny logik:
  remoteBuildingGuids = remoteFmGuids filtered to only Building category
  orphans = localGuids.filter(g => {
    // Skip if this object belongs to a building not in Asset+
    const buildingGuid = buildingLookup[g]
    if (buildingGuid && !remoteBuildingGuids.has(buildingGuid)) return false
    return !remoteFmGuids.has(g)
  })
```

#### 2. Återskapa hierarkin för SV nu

Kör `ifc-extract-systems` med `metadata-only` mode mot den befintliga metadata-filen för att populera storeys/spaces igen.

#### 3. Fixa XKT-versionsproblemet (separat men relaterat)

Konsolloggarna visar: `Unsupported .XKT file version: 12 - this XKTLoaderPlugin supports versions 1,2,3,4,5,6,7,8,9,10`

Browser-konverteringen producerar XKT v12 men xeokit SDK:n i `public/lib/xeokit/xeokit-sdk.es.js` stödjer bara v1-10. Detta måste också åtgärdas (uppgradera xeokit SDK eller downgrade XKT-output) — annars laddas inget 3D-innehåll alls.

### Sammanfattning av ändringar

| Fil | Ändring |
|-----|---------|
| `supabase/functions/asset-plus-sync/index.ts` | Lägg till building-scope-check i orphan-filtrering |
| Edge function call (runtime) | Kör `ifc-extract-systems` metadata-only för SV |

### Teknisk detalj

Ändringen i orphan-filtret kräver att vi hämtar `building_fm_guid` tillsammans med `fm_guid` i `fetchAllLocalFmGuids`, och sedan kollar om byggnaden finns bland remote-objekten. Ca 15 rader kodändring.

