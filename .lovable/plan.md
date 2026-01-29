
# Plan: Fixa Dubbleringar och Fel "Finns i modell"-status i AssetsView

## Sammanfattning av Identifierade Problem

### Problem 1: Inventerade objekt visas flera gånger
**Symptom:** "Pål brandsläckare 2", "Påls sensor 2" och "Testbrandsläckare" visas tre gånger vardera i listan.

**Grundorsak:** Databasen innehåller KORREKTA data (endast EN post per objekt). Duplikationen sker i frontend - troligtvis i `navigatorTreeData` som innehåller samma byggnad flera gånger, eller i `allData` som på något sätt har blivit förorenad med dubbletter.

**Lösning:** 
1. Lägg till deduplicering i `getAssetsForFacility()` i PortfolioView
2. Lägg till deduplicering i `assetData` i AssetsView baserat på `fmGuid`
3. Lägg till säkerhetscheck i `refreshInitialData()` för att säkerställa inga dubbletter

### Problem 2: "Finns i modell" visar fel status (Ja/grön istället för Nej)
**Symptom:** Inventerade objekt har `created_in_model: false` i databasen, men visar "Ja" (grön) i UI.

**Grundorsak:** Fallback-logiken i rad 253 av AssetsView:
```typescript
createdInModel: asset.created_in_model ?? attrs.createdInModel ?? true,
```
Om `created_in_model` kommer som `undefined` istället för `false`, faller koden igenom till `true`.

**Lösning:** Ändra fallback till explicit `false`:
```typescript
createdInModel: asset.created_in_model === true, // Explicit sant, annars falskt
```

### Problem 3: Visa 3D och annotations vid selektion
**Krav:** När man selekterar ett inventerat objekt ska 3D-viewern öppnas och annotation ska visas automatiskt.

**Lösning:** Uppdatera `handleOpen3D` i AssetsView för att:
1. Öppna viewern för rätt byggnad
2. Aktivera "Visa lokala annotations" automatiskt

---

## Teknisk Implementering

### Steg 1: Fixa Deduplicering i AssetsView

**Fil:** `src/components/portfolio/AssetsView.tsx`

Ändra `assetData` useMemo (rad 240-260):
```typescript
const assetData: AssetData[] = useMemo(() => {
  // Deduplicate by fmGuid first
  const seenGuids = new Set<string>();
  const uniqueAssets = assets.filter((asset) => {
    const guid = asset.fm_guid || asset.fmGuid;
    if (seenGuids.has(guid)) return false;
    seenGuids.add(guid);
    return true;
  });
  
  return uniqueAssets.map((asset) => {
    const attrs = asset.attributes || {};
    return {
      fmGuid: asset.fm_guid || asset.fmGuid,
      // ... resten av mappningen
      // VIKTIGT: Ändra createdInModel logik:
      createdInModel: asset.created_in_model === true, // Explicit sant-check
      // ... resten
    };
  });
}, [assets]);
```

### Steg 2: Fixa Deduplicering i PortfolioView

**Fil:** `src/components/portfolio/PortfolioView.tsx`

Ändra `getAssetsForFacility` (rad 202-211):
```typescript
const getAssetsForFacility = (facility: Facility) => {
  if (!allData) return [];
  const isBuilding = facility.category === 'Building';
  const isStorey = facility.category === 'Building Storey';
  
  const filtered = allData.filter((item: any) => 
    item.category === 'Instance' &&
    (isBuilding ? item.buildingFmGuid === facility.fmGuid : 
     isStorey ? item.levelFmGuid === facility.fmGuid : false)
  );
  
  // Deduplicate by fmGuid
  const seen = new Set<string>();
  return filtered.filter((item: any) => {
    const guid = item.fmGuid || item.fm_guid;
    if (seen.has(guid)) return false;
    seen.add(guid);
    return true;
  });
};
```

### Steg 3: Fixa "createdInModel" fallback

**Fil:** `src/components/portfolio/AssetsView.tsx` (rad 253)

Nuvarande kod:
```typescript
createdInModel: asset.created_in_model ?? attrs.createdInModel ?? true,
```

Ändras till:
```typescript
createdInModel: asset.created_in_model === true || asset.createdInModel === true,
```

Detta säkerställer att endast objekt med explicit `true` visas som "Ja". Alla andra (inklusive `false`, `undefined`, `null`) blir "Nej".

### Steg 4: Auto-aktivera Annotations vid 3D-öppning

**Fil:** `src/components/portfolio/AssetsView.tsx`

Uppdatera `handleOpen3D`:
```typescript
const handleOpen3D = (asset: AssetData) => {
  if (onOpen3D) {
    // If this is a local asset, we might want to enable annotations
    if (asset.isLocal || !asset.createdInModel) {
      // Store preference to show local annotations
      localStorage.setItem('viewer-show-local-annotations', 'true');
    }
    onOpen3D(asset.fmGuid, asset.levelFmGuid);
  }
};
```

Och i **AssetPlusViewer.tsx**, läs denna preference och aktivera annotations automatiskt.

---

## Filer som påverkas

| Fil | Ändringar |
|-----|-----------|
| `src/components/portfolio/AssetsView.tsx` | Deduplicering, createdInModel fix, handleOpen3D uppdatering |
| `src/components/portfolio/PortfolioView.tsx` | Deduplicering i getAssetsForFacility |
| `src/components/viewer/AssetPlusViewer.tsx` | Auto-aktivera lokala annotations |

---

## Verifiering

1. Öppna Portfolio → Centralstationen → Assets
2. Verifiera att varje inventerat objekt bara visas EN gång
3. Verifiera att "Finns i modell" visar "Nej" för inventerade objekt
4. Klicka på "Öppna i 3D" för ett inventerat objekt
5. Verifiera att 3D-viewern öppnas och annotation syns
