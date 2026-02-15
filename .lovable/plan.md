

## Fix: Synlig Eye-ikon och borttagning av onödig tooltip på mobil

### Problem
1. **Eye-ikonen syns inte** -- `bg-primary/15` (15% opacitet) är i princip osynlig mot mörk bakgrund på iPhone.
2. **Svart tooltip-popup dyker upp** vid tryck på staplar i "Energy per Floor"-diagrammet istället för att navigera till 3D. Recharts visar sin tooltip vid touch-event, vilket blockerar klick-navigeringen.
3. Inga visuella signaler om att korten är interaktiva på mörkt tema.

### Lösning

**Fil: `src/components/insights/BuildingInsightsView.tsx`**

**1. Gör ViewerLink-ikonen väl synlig:**
- Ändra bakgrund från `bg-primary/15` till `bg-primary/20 border border-primary/40`
- Öka ikonstorleken till `h-4.5 w-4.5` (lite större på mobil)
- Lägg till en tydlig `shadow-sm shadow-primary/20` för att skapa kontrast mot mörk bakgrund
- Puls-ringen: ändra från `ring-primary/30` till `ring-primary/50` för bättre synlighet

**2. Stäng av Recharts Tooltip på mobil i Energy per Floor-diagrammet:**
- Villkorsrendera `<Tooltip>` enbart om `!isMobile` -- på mobil ska tryck på en stapel direkt navigera till 3D utan att visa tooltip
- Alternativt: sätt `active={false}` eller ta bort Tooltip helt från bar chart på mobil

**3. Gör bar-staplarna visuellt klickbara på mobil:**
- Lägg till `cursor: 'pointer'` på `<Bar>`-komponenten
- Flytta `onClick`-hanteringen från `<BarChart>` till individuell `<Cell onClick>` för pålitligare touch-respons

### Tekniska detaljer

```text
ViewerLink-ikon (rad 34-45):
  Nuvarande:  bg-primary/15, ring-primary/30
  Nytt:       bg-primary/25 border border-primary/50 shadow-sm shadow-primary/25, ring-primary/60

Energy per Floor Tooltip (rad 299):
  Nuvarande:  <Tooltip contentStyle={...} />
  Nytt:       {!isMobile && <Tooltip contentStyle={...} />}

Bar onClick (rad 287-291):
  Flytta onClick från BarChart till Cell-nivå för säkrare touch-events på mobil.
  Varje Cell får onClick={() => navigateTo3D({ entity: entry.fmGuid })}
```

### Sammanfattning
- Eye-ikonen blir en tydlig, konturerad cirkel med skugga som syns även på helsvart bakgrund
- Tryck på staplar navigerar direkt till 3D utan mellanliggande tooltip
- Alla ändringar görs i en enda fil: `BuildingInsightsView.tsx`
