

## Nytt Fargtema: "Nordic Pro" -- Enhetlig Diagrampalett

### Problem

Appen har 4+ separata fargpaletter for diagram, KPI-kort och kartor som inte ar koordinerade. Harkodade vardan som `hsl(48, 96%, 53%)` (skrikig gul), `hsl(142, 71%, 45%)` (neongrn) och `text-yellow-500` (Tailwind default) ger ett "gratis dashboard-template"-intryck snarare an premium PropTech.

### Designprincip

Inspirerat av Autodesk Tandem, Linear och Vercel:
- **En enda palett med 8 farger** som alla harleds fran primarkfargen (lila/indigo) och dess komplementarer
- **Daempade, mattade toner** istallet for neon -- hogre professionalism
- **Semantiska farger** (bra/daligt) har kvar men i mattade varianter
- Paletten fungerar pa bade ljust och morkt tema

### Ny Palett: "Nordic Pro"

**Ljust tema (`:root`):**

| Variabel | HSL | Hex (approx) | Anvandning |
|---|---|---|---|
| `--chart-1` | `252 56% 57%` | #7C5CCA | Primar dataserie (lila -- app-primar) |
| `--chart-2` | `199 72% 48%` | #2298C9 | Sekundar (kall bla -- kontrast) |
| `--chart-3` | `166 52% 46%` | #38A88C | Positiv/tillvaxt (mattad teal) |
| `--chart-4` | `32 70% 56%` | #D4913B | Varning/medel (varm amber) |
| `--chart-5` | `348 58% 56%` | #C94F6D | Negativ/risk (mattad rosa) |
| `--chart-6` | `220 50% 62%` | #6F8DC0 | Stodfarger (ljus bla-gra) |
| `--chart-7` | `280 42% 58%` | #9F6DB8 | Stodfarger (lavendel) |
| `--chart-8` | `142 40% 42%` | #408F5E | Positiv stark (mork gron) |

**Morkt tema (`.dark`):**

Samma nyanser med +10% ljusstyrka och -5% mattning for bra kontrast mot morka bakgrunder.

| Variabel | HSL |
|---|---|
| `--chart-1` | `252 62% 68%` |
| `--chart-2` | `199 68% 58%` |
| `--chart-3` | `166 48% 56%` |
| `--chart-4` | `32 65% 62%` |
| `--chart-5` | `348 54% 62%` |
| `--chart-6` | `220 45% 68%` |
| `--chart-7` | `280 38% 65%` |
| `--chart-8` | `142 36% 52%` |

**SWG-tema (`.swg`):**

Anpassat till teal-primart med chart-1 som teal:

| Variabel | HSL |
|---|---|
| `--chart-1` | `186 56% 52%` |
| `--chart-2` | `220 55% 58%` |
| `--chart-3` | `166 48% 50%` |
| `--chart-4` | `32 60% 58%` |
| `--chart-5` | `348 50% 58%` |
| `--chart-6` | `199 45% 62%` |
| `--chart-7` | `280 35% 60%` |
| `--chart-8` | `142 36% 48%` |

### Semantiska Fargkonstanter

Skapa en `CHART_COLORS`-konstant i `src/lib/chart-theme.ts` som alla diagram importerar:

```text
CHART_COLORS = {
  primary:   'hsl(var(--chart-1))',
  secondary: 'hsl(var(--chart-2))',
  positive:  'hsl(var(--chart-3))',
  warning:   'hsl(var(--chart-4))',
  negative:  'hsl(var(--chart-5))',
  support1:  'hsl(var(--chart-6))',
  support2:  'hsl(var(--chart-7))',
  success:   'hsl(var(--chart-8))',
}

SEQUENTIAL_PALETTE = [
  primary, secondary, positive, warning,
  negative, support1, support2, success,
]

ENERGY_RATING_COLORS = {
  A: 'hsl(var(--chart-8))',   -- mork gron
  B: 'hsl(var(--chart-3))',   -- teal
  C: 'hsl(var(--chart-4))',   -- amber
  D: 'hsl(var(--chart-5))',   -- rosa
  E: 'hsl(var(--destructive))', -- rod (befintlig)
}

RISK_COLORS = {
  Low:    'hsl(var(--chart-3))',
  Medium: 'hsl(var(--chart-4))',
  High:   'hsl(var(--chart-5))',
}
```

### KPI-ikonfarger

Ersatt alla `text-green-500`, `text-blue-500`, `text-yellow-500` med semantiska fargklasser kopplade till chart-variablerna:

| Nuvarande | Nytt |
|---|---|
| `text-green-500` | `text-[hsl(var(--chart-3))]` |
| `text-blue-500` | `text-[hsl(var(--chart-2))]` |
| `text-yellow-500` | `text-[hsl(var(--chart-4))]` |
| `text-orange-500` | `text-[hsl(var(--chart-4))]` |
| `text-red-500` | `text-[hsl(var(--chart-5))]` |
| `text-purple-500` | `text-[hsl(var(--chart-7))]` |

### Kart-fargpalett

Uppdatera `src/lib/map-coloring-utils.ts` COLORS-objektet till att anvanda samma hex-varden som chart-paletten for visuell enhet mellan diagram och karta.

### Filer som andras

1. **`src/index.css`** -- Uppdatera `--chart-1` till `--chart-8` i alla 3 teman
2. **`src/lib/chart-theme.ts`** (ny) -- Exporterar `CHART_COLORS`, `SEQUENTIAL_PALETTE`, `ENERGY_RATING_COLORS`, `RISK_COLORS`
3. **`src/components/insights/tabs/PerformanceTab.tsx`** -- Byt harkodade `hsl(...)` till `CHART_COLORS`
4. **`src/components/insights/tabs/PortfolioManagementTab.tsx`** -- Byt harkodade farger
5. **`src/components/insights/tabs/AssetManagementTab.tsx`** -- Byt harkodade farger
6. **`src/components/insights/BuildingInsightsView.tsx`** -- Byt `FLOOR_COLORS` och paj-farger
7. **`src/components/insights/RoomSensorDetailSheet.tsx`** -- Byt stroke-farger
8. **`src/lib/map-coloring-utils.ts`** -- Synka COLORS-objekt med nya paletten

### Resultat

- Alla diagram, KPI-kort och kartor anvander en enda harmonisk palett
- Temat foljer automatiskt ljust/morkt/SWG via CSS-variabler
- Inga fler harkodade `hsl(...)` eller `text-green-500` i diagram-komponenter
- Professionellt, mattad, "Nordic design"-estetik istallet for neon-dashboard

