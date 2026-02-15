

## Gör "Visa visuellt"-kopplingen tydlig på mobil

### Problem
De nuvarande Badge-elementen ("3D" med Eye-ikon) ar bara 8px text i en 16px-hog badge -- nastan osynliga pa en iPhone-skarm. Dessutom vill vi anvanda en mer generisk visuell signal istallet for "3D" eftersom framtida vyer inkluderar 2D och 360.

### Losning: Tydlig visuell knapp pa interaktiva kort

**Strategi**: Ersatt de sma Badge-elementen med en tydlig, rund ikon-knapp (Eye) som alltid syns, med en subtil bakgrund och pulseffekt for att signalera interaktivitet.

**KPI-kort (rad 222-242)**:
- Ta bort den lilla Badge-komponenten
- Lagg till en rund Eye-ikon (24x24px) med bakgrundsfargen `bg-primary/15` och `text-primary` i hornet av kortet
- Lagg till en liten animerad puls-ring runt ikonen for att dra uppmarksamhet

**Energy per Floor-kortet (rad 266-301)**:
- Lagg till en Eye-ikon bredvid titeln med samma stil
- Behall texten "Tryck pa stapel for 3D" i CardDescription

**Room Types-kortet (rad 362-393)**:
- Ersatt den lilla Badge med samma runda Eye-ikon som KPI-korten
- Behall "Tryck for att visa"-texten i CardDescription

### Tekniska detaljer

**Ny komponent `ViewerLink`** (inline i BuildingInsightsView):
En liten atervandbar komponent som renderar en rund Eye-ikon med konsekvent stil:

```text
Rund cirkel: w-7 h-7 (28px) pa mobil, w-8 h-8 (32px) pa desktop
Bakgrund: bg-primary/15
Ikon: Eye fran lucide-react, text-primary, h-4 w-4
Hover: bg-primary/25
Valfri puls-animation via ring-effekt (ring-2 ring-primary/30 animate-pulse, 
men bara i 3 sekunder efter laddning sa den inte ar irriterande)
```

**Filer att andra:**
- `src/components/insights/BuildingInsightsView.tsx` -- Ersatt Badge med ViewerLink-ikon pa alla interaktiva kort

**Ingen ny fil behover skapas** -- ViewerLink definieras som en liten inline-komponent langst upp i filen.

### Sammanfattning
Anvandaren ser en tydlig, rund Eye-ikon (ca 28px) pa varje klickbart kort -- tillrackligt stor for att uppfattas pa mobil, med en subtil bakgrund som signalerar "har finns mer att se". Texten "3D" tas bort till formaan for en generisk Eye som fungerar oavsett visningslage (2D, 3D, 360).

