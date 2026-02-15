

## Fix: Eye-ikonen syns inte pa mobil

### Rotorsak
Tailwind CSS har **inte** klasser som `h-4.5` eller `w-4.5` -- de finns helt enkelt inte. Darfor renderas Eye-ikonen med storlek 0 och ar helt osynlig. Dessutom ar bakgrunden (`bg-primary/25`) for svag mot mork bakgrund.

### Losning

**Fil: `src/components/insights/BuildingInsightsView.tsx`**

**1. Fixa ViewerLink-komponenten (rad 34-45):**
- Andra `h-4.5 w-4.5` till giltiga Tailwind-klasser: `h-5 w-5`
- Oka bakgrundsopacitet fran `bg-primary/25` till `bg-primary/30`
- Oka border-opacitet till `border-primary/60`
- Oka puls-ringen till `ring-primary/70` for tydligare animation
- Lagga till `shadow-lg shadow-primary/30` for battre kontrast mot mork bakgrund

**2. Stang av tooltip pa mobil aven for Room Types-diagrammet (rad 386):**
- Wrappa `<Tooltip>` i `{!isMobile && ...}` aven for Room Types-kortet (samma som redan gjorts for Energy per Floor)

### Teknisk sammanfattning

```text
ViewerLink forandring:
  Ikon:      h-4.5 w-4.5 (OGILTIG) -> h-5 w-5 (giltig, 20px)
  Bakgrund:  bg-primary/25 -> bg-primary/30
  Border:    border-primary/50 -> border-primary/60
  Skugga:    shadow-sm shadow-primary/25 -> shadow-lg shadow-primary/30
  Puls:      ring-primary/60 -> ring-primary/70

Room Types Tooltip (rad 386):
  <Tooltip .../> -> {!isMobile && <Tooltip .../>}
```

Dessa andringar ar minimala men loser det faktiska problemet: ikonen renderas nu med korrekt storlek och syns tydligt pa alla enheter.

