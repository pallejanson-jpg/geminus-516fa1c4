

## Fix: Solo-isolering fungerar inte pa mobil

### Problem
Nar du navigerar till 3D-visaren med en vald byggnad, vaning, rum eller tillgang (via URL-parametern `entity`) sa isoleras (Solo mode) ratt vaningsplan pa desktop -- men inte pa mobil.

### Orsak
I `UnifiedViewer.tsx` renderas en separat `MobileUnifiedViewer`-komponent for mobila enheter (rad 266). Denna komponent skickar **inte** med `initialFmGuidToFocus`-propen till `AssetPlusViewer`, trots att den finns tillganglig via URL-parametern `entity`. Pa desktop skickas den korrekt (rad 426).

### Losning
Skicka `entityFmGuid` som `initialFmGuidToFocus` till `AssetPlusViewer` i `MobileUnifiedViewer`, precis som pa desktop.

### Tekniska detaljer

**`src/pages/UnifiedViewer.tsx`**

1. Lagg till `entityFmGuid` som prop till `MobileUnifiedViewer` (i interfacet och vid anrop, rad 266-283).
2. I `MobileUnifiedViewer`-funktionen, skicka med `initialFmGuidToFocus={entityFmGuid || undefined}` till `AssetPlusViewer` (rad 578-585).

Fore (mobil):
```typescript
<AssetPlusViewer
  fmGuid={buildingData.fmGuid}
  syncEnabled={false}
  ...
/>
```

Efter (mobil):
```typescript
<AssetPlusViewer
  fmGuid={buildingData.fmGuid}
  initialFmGuidToFocus={entityFmGuid || undefined}
  syncEnabled={false}
  ...
/>
```

Detta foljer principen om desktop-mobil-paritet och saker att Solo mode med takklippning aktiveras korrekt aven pa mobil.
