

## Slå ihop till EN byggnads-insights-komponent

### Problem
Det finns två nästan identiska filer som visar insights för en byggnad:
- `BuildingInsightsView.tsx` (438 rader, har alla fixar: "Visa"-knappar, tooltip-borttagning, 3D-navigering)
- `EntityInsightsView.tsx` (418 rader, har inga fixar)

De används från olika navigeringsvägar men gör exakt samma sak. Detta orsakar att fixar i en fil aldrig syns om användaren navigerar via den andra.

### Lösning

1. **Behåll `BuildingInsightsView.tsx`** som den enda komponenten (den som redan har alla fixar)
2. **Ta bort `EntityInsightsView.tsx`** helt
3. **Uppdatera `MainContent.tsx`** så att `entity_insights`-caset använder `BuildingInsightsView` istället

### Ändringar per fil

**`src/components/layout/MainContent.tsx`**
- Ta bort importen av `EntityInsightsView`
- I `case 'entity_insights'`: ersätt `<EntityInsightsView>` med `<BuildingInsightsView>`
- Uppdatera importraden till `BuildingInsightsView` (redan importerad via `InsightsView`, men behöver en direkt import)

**`src/components/insights/EntityInsightsView.tsx`**
- Radera filen helt

**`src/components/insights/InsightsView.tsx`**
- Ingen ändring behövs (använder redan `BuildingInsightsView`)

### Teknisk detalj

```text
MainContent.tsx (rad 12, 69-76):

  NUVARANDE:
    import EntityInsightsView from "...EntityInsightsView";
    case 'entity_insights':
      return <EntityInsightsView facility={...} onBack={...} />;

  NYTT:
    import BuildingInsightsView from "...BuildingInsightsView";
    case 'entity_insights':
      return <BuildingInsightsView facility={...} onBack={...} />;
```

### Resultat
- En enda komponent for byggnads-insights oavsett navigeringsvag
- Alla fixar (Visa-knappar, tooltip-borttagning, 3D-navigering) fungerar overallt
- Mindre kod att underhalla
