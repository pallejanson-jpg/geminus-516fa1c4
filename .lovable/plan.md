
# Plan: Fixa Asset-namngivning och POI-skapande i Ivion

## Översikt

Det finns två problem som behöver åtgärdas:

1. **Assets visar GUID istället för vänligt namn** - När assets från Asset+ saknar både `name` och `common_name`, visas GUID:en istället för något mer läsbart
2. **POI-skapande misslyckas** - Ivion API kräver obligatoriska fält som saknas i anropet

---

## Problem 1: Bättre namngivning av assets

### Nuvarande kod (UnplacedAssetsPanel.tsx rad 61-69)
```tsx
setAssets(
  (data || []).map((a) => ({
    id: a.id,
    fm_guid: a.fm_guid,
    name: a.name || a.common_name || a.fm_guid,  // Fallback till GUID
    asset_type: a.asset_type,
    category: a.category,
  }))
);
```

### Problem
- `name = NULL` och `common_name = NULL` för många BIM-assets
- Fallback till GUID ger oläsbara namn som `23d71dd2-af15-401e-aae6-663876af78e6`

### Lösning
Utöka fallback-kedjan för att använda `asset_type` (t.ex. "IfcBeam", "IfcDoor") med formatering:

```tsx
// Hjälpfunktion för att formatera asset_type
const formatAssetType = (type: string | null): string => {
  if (!type) return '';
  // "IfcBeam" → "Beam", "IfcWallStandardCase" → "Wall Standard Case"
  return type
    .replace(/^Ifc/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
};

// Förbättrad namnlogik
const displayName = 
  a.name || 
  a.common_name || 
  formatAssetType(a.asset_type) ||
  `Okänd (${a.fm_guid.slice(0, 8)}...)`;
```

### Filer att ändra
- **`src/components/inventory/UnplacedAssetsPanel.tsx`** - Uppdatera namnlogik på rad 61-69 och rad 164-172

---

## Problem 2: POI-skapande misslyckas - saknade obligatoriska fält

### Felmeddelande från Ivion API
```
Validation failed with 6 errors:
- scsLocation: must not be null
- scsOrientation: must not be null
- poiTypeId: must not be null
- security.groupRead: must not be null
- security.groupWrite: must not be null
- visibilityCheck: must not be null
```

### Nuvarande kod skickar (ivion-poi/index.ts rad 429-444)
```typescript
const poiData: Partial<IvionPoi> = {
  titles: { sv: asset.name || asset.common_name || 'Unnamed' },
  descriptions: { sv: asset.attributes?.description || '' },
  location: { x: ..., y: ..., z: ... },  // ❌ Fel fältnamn
  orientation: { x: 0, y: 0, z: 0, w: 1 }, // ❌ Fel fältnamn
  importance: 1,
  customData: JSON.stringify({...}),
  // ❌ Saknar: scsLocation, scsOrientation, poiTypeId, security, visibilityCheck
};
```

### Lösning
Uppdatera `syncAssetToPoi` och `createPoi` för att skicka alla obligatoriska fält:

1. **Hämta POI-typer** från siten för att få ett giltigt `poiTypeId`
2. **Hämta säkerhetsgrupper** (eller använd standardvärden)
3. **Använd rätt fältnamn** (`scsLocation`, `scsOrientation`)
4. **Lägg till `visibilityCheck`**

### Uppdaterad POI-struktur
```typescript
const poiData = {
  titles: { sv: displayName },
  descriptions: { sv: '' },
  scsLocation: {
    type: 'Point',
    coordinates: [asset.coordinate_x || 0, asset.coordinate_y || 0, asset.coordinate_z || 0]
  },
  scsOrientation: { x: 0, y: 0, z: 0, w: 1 },
  poiTypeId: defaultPoiTypeId,  // Hämta från site's POI types
  security: {
    groupRead: 0,   // 0 = alla kan läsa (public)
    groupWrite: 0   // 0 = alla kan skriva
  },
  visibilityCheck: false,
  importance: 1,
  customData: JSON.stringify({
    fm_guid: asset.fm_guid,
    asset_type: asset.asset_type,
    source: 'geminus',
  }),
};
```

### Filer att ändra
- **`supabase/functions/ivion-poi/index.ts`**
  - Uppdatera `IvionPoi` interface med korrekta fält
  - Uppdatera `syncAssetToPoi` för att hämta POI-typ och inkludera alla obligatoriska fält
  - Lägg till logik för att hämta default POI-typ från siten

---

## Implementeringsdetaljer

### Del 1: UnplacedAssetsPanel.tsx ändringar

Rad 61-69 och 164-172 ändras till:
```tsx
// Hjälpfunktion
const getDisplayName = (asset: any): string => {
  if (asset.name) return asset.name;
  if (asset.common_name) return asset.common_name;
  if (asset.asset_type) {
    return asset.asset_type
      .replace(/^Ifc/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2');
  }
  return `Okänd (${asset.fm_guid.slice(0, 8)}...)`;
};

setAssets(
  (data || []).map((a) => ({
    id: a.id,
    fm_guid: a.fm_guid,
    name: getDisplayName(a),
    asset_type: a.asset_type,
    category: a.category,
  }))
);
```

### Del 2: ivion-poi Edge Function ändringar

**Steg 1: Uppdatera interface (rad 45-61)**
```typescript
interface IvionPoi {
  id?: number;
  titles: Record<string, string>;
  descriptions: Record<string, string>;
  scsLocation: {
    type: 'Point';
    coordinates: [number, number, number];
  };
  scsOrientation: { x: number; y: number; z: number; w: number };
  poiTypeId: number;
  security: {
    groupRead: number;
    groupWrite: number;
  };
  visibilityCheck: boolean;
  importance: number;
  customData?: string;
  icon?: string;
  // Legacy fields for reading existing POIs
  location?: { x: number; y: number; z: number };
  orientation?: { x: number; y: number; z: number; w: number };
  poiType?: { id: number };
}
```

**Steg 2: Lägg till funktion för att hämta default POI-typ**
```typescript
async function getDefaultPoiTypeId(siteId: string): Promise<number> {
  try {
    const types = await getPoiTypes(siteId);
    if (types.length > 0) {
      // Försök hitta en "generic" eller "default" typ, annars första
      const genericType = types.find(t => 
        t.name?.toLowerCase().includes('generic') ||
        t.name?.toLowerCase().includes('default') ||
        t.name?.toLowerCase().includes('other')
      );
      return genericType?.id || types[0].id;
    }
  } catch (e) {
    console.log('Could not fetch POI types, using default 1');
  }
  return 1; // Fallback
}
```

**Steg 3: Uppdatera syncAssetToPoi (rad 394-463)**
```typescript
async function syncAssetToPoi(assetFmGuid: string): Promise<...> {
  // ... existing asset fetch code ...
  
  // Get default POI type for this site
  const poiTypeId = await getDefaultPoiTypeId(siteId);
  
  // Get display name
  const displayName = asset.name || asset.common_name || 
    (asset.asset_type?.replace(/^Ifc/, '') || 'Unnamed');
  
  const poiData = {
    titles: { sv: displayName },
    descriptions: { sv: asset.attributes?.description || '' },
    scsLocation: {
      type: 'Point',
      coordinates: [
        asset.coordinate_x || 0,
        asset.coordinate_y || 0,
        asset.coordinate_z || 0
      ]
    },
    scsOrientation: { x: 0, y: 0, z: 0, w: 1 },
    poiTypeId,
    security: { groupRead: 0, groupWrite: 0 },
    visibilityCheck: false,
    importance: 1,
    customData: JSON.stringify({
      fm_guid: asset.fm_guid,
      asset_type: asset.asset_type,
      source: 'geminus',
    }),
  };
  
  // ... create POI ...
}
```

---

## Sammanfattning av ändringar

| Fil | Ändring |
|-----|---------|
| `src/components/inventory/UnplacedAssetsPanel.tsx` | Förbättrad namnlogik med fallback till formaterad `asset_type` |
| `supabase/functions/ivion-poi/index.ts` | Uppdaterat interface och `syncAssetToPoi` med alla obligatoriska Ivion-fält |

---

## Testplan

1. Öppna Ivion-inventering och verifiera att assets utan namn nu visar formaterad asset_type (t.ex. "Beam" istället för GUID)
2. Välj en asset och klicka "Skapa POI" - verifiera att POI skapas utan fel
3. Kontrollera i Ivion att den skapade POI:n har korrekt namn och FMGUID i custom attributes
