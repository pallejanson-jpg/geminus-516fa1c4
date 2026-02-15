

## Fix: Gör 3D-kopplingen synlig på mobil

### Problem
KPI-kortens "Visa i 3D"-indikation använder hover-effekter som inte fungerar på touch-enheter. Eye-ikonen och texten är dolda på mobil. Diagrammen har ingen visuell signal om att de är klickbara.

### Lösning

**Fil: `src/components/insights/BuildingInsightsView.tsx`**

1. **KPI-kort**: Ta bort `opacity-0 group-hover:opacity-100` från Eye-ikonen så den alltid syns. Lägg till en liten "3D"-etikett som alltid visas (även på mobil) istället för att dölja "Visa i 3D" med `hidden sm:inline`.

2. **Energy per Floor-diagram**: Lägg till en synlig text-hint i `CardDescription` som fungerar på mobil, t.ex. "Tryck på stapel för att visa i 3D". Lägg till en subtil border-effekt (`border-primary/30`) på kortet för att signalera interaktivitet.

3. **Room Types-diagram**: Kortet har redan `cursor-pointer` och en Eye-ikon, men ikonen behöver vara tydligare. Lägg till en liten "Visa i 3D"-badge bredvid Eye-ikonen som alltid syns.

### Tekniska detaljer

**KPI-kort (rad 226-231)**: Ändra Eye-ikonen från `opacity-0 group-hover:opacity-100` till alltid synlig med en subtil färg (`text-primary/60`). Ersätt den dolda "Visa i 3D"-texten med en liten Badge som visar "3D" och är synlig på alla skärmstorlekar.

**Energy per Floor (rad 277)**: Uppdatera `CardDescription` till att inkludera "Tap bar to view in 3D" på mobil.

**Room Types (rad 371-373)**: Gör Eye-ikonen tydligare och lägg till en "3D"-badge bredvid den.

**Samtliga kort med `onView`**: Lägg till en tunn `border-primary/20`-ram som visuell signal att kortet är interaktivt.

