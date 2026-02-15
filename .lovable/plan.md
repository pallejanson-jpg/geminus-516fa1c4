

## Fix: Alla ikoner och tooltips på Insights-sidan (mobil)

### Problem
1. **Eye-ikonen syns fortfarande inte på mobil** -- trots korrekta Tailwind-klasser är `bg-primary/30` (genomskinlig lila på mörk bakgrund) för svag. Ikonen smälter in och syns inte.
2. **Svart tooltip dyker upp på cirkeldiagram** -- vi stängde av tooltip på "Room Types" och "Energy per Floor", men **Energy Distribution** (rad 327) och **Asset Categories** (rad 421) har fortfarande aktiva tooltips som blockerar touch.
3. **Ingen navigering från cirkeldiagram** -- Energy Distribution och Asset Categories har ingen onClick-koppling till 3D-vyn.

### Lösning

**Fil: `src/components/insights/BuildingInsightsView.tsx`**

**1. Ersätt ViewerLink med en synlig, solid knapp**

Istället för en genomskinlig cirkel med en liten ikon, använd en tydlig knapp med text + ikon:

```text
Ny design:
  - Bakgrund: bg-primary (solid, inte genomskinlig)
  - Text: text-primary-foreground (vit mot lila)
  - Storlek: px-2 py-1 rounded-md text-xs font-medium
  - Innehåll: Eye-ikon (h-3.5 w-3.5) + texten "Visa"
  - Puls: ring-2 ring-primary/50 animate-pulse (3 sek)
```

Detta ger en tydlig, läsbar knapp som inte kan missas.

**2. Stäng av tooltip på mobil för ALLA diagram**

Tre kvarvarande `<Tooltip>`-element som behöver wrappas i `{!isMobile && ...}`:
- Energy Distribution (rad 327)
- Monthly Energy Trend (rad 352)
- Asset Categories (rad 421)

**3. Lägg till navigering på fler kort**

- Energy Distribution: Ingen ändring (mock-data, ingen naturlig 3D-koppling)
- Asset Categories: Lägg till onClick som navigerar till 3D-vyn med assets

### Tekniska detaljer

```text
ViewerLink-komponent (rad 34-45):
  NUVARANDE: genomskinlig cirkel med Eye-ikon, bg-primary/30
  NYTT:      solid knapp "Visa" med Eye-ikon, bg-primary text-primary-foreground

Tooltip-ändringar:
  Rad 327 (Energy Distribution):  <Tooltip .../> -> {!isMobile && <Tooltip .../>}
  Rad 352 (Monthly Trend):        <Tooltip .../> -> {!isMobile && <Tooltip .../>}
  Rad 421 (Asset Categories):     <Tooltip .../> -> {!isMobile && <Tooltip .../>}
```

### Sammanfattning
- Eye-ikonen ersätts med en solid, omisskännlig "Visa"-knapp med text
- ALLA tooltips stängs av på mobil så att touch-events fungerar direkt
- En enda fil ändras: `BuildingInsightsView.tsx`

