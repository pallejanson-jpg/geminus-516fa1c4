

# Fix: Rum filtreras inte vid våningsval i FilterPanel

## Grundorsak

Rad 278-280 i `ViewerFilterPanel.tsx` matchar `relevantFloors` med **exakt strängjämförelse** istället för normaliserad GUID-matchning:

```typescript
// BUG — rad 280:
return relevantLevelItems.some(l => l.fmGuid === primaryGuid);
```

Om `l.fmGuid` har bindestreck men `primaryGuid` inte har det (eller vice versa), misslyckas matchningen. Det innebär att `allLevelGuids` (rad 267) förblir tomt, `visibleLevelGuids` blir en tom Set, och sedan på rad 294 passerar filtret utan att filtrera — alla rum visas oavsett vald våning.

Dessutom finns ytterligare en icke-normaliserad jämförelse på rad 296 (`a.levelFmGuid`) som redan ÄR normaliserad korrekt — men om `visibleLevelGuids` aldrig fylldes på grund av ovanstående bug, spelar det ingen roll.

## Fix

**Fil:** `src/components/viewer/ViewerFilterPanel.tsx`

### Ändring 1 — Rad 278-280
Byt exakt matchning till normaliserad:
```typescript
const relevantFloors = sharedFloors.filter(f => {
  const primaryGuid = normalizeGuid(f.databaseLevelFmGuids[0] || f.id);
  return relevantLevelItems.some(l => normalizeGuid(l.fmGuid) === primaryGuid);
});
```

### Ändring 2 — Säkerhetsnät
Lägg till debug-logg (temporärt) för att verifiera att filtreringen fungerar, samt säkerställ att fallback-logiken (rad 302-327) också triggar korrekt om entityMap redan är byggd.

En enda rad-fix i en fil, inga nya filer.

