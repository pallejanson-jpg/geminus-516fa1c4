

# Analys: Svarta ytor och layoutproblem i 2D/3D split

## Problem från bilden

1. **Svarta ytor i 2D-planen** — `createStoreyMap()` genererar en planritning där *alla väggar, pelare, balkar, räcken, trappor och bjälklag* temporärt färgas svart (rad 383-388: `entity.colorize = [0, 0, 0]`). Men problemet är att **bakgrunden i snapshot-bilden** också är svart/transparent. xeokits `createStoreyMap` renderar med genomskinlig bakgrund och alla icke-vägg-objekt (golv, dörrar, möbler) visas som de är — men i "Architect mode" har vi redan färgat dessa i ljusa nyanser. Det som syns som stora svarta fält är sannolikt **ifcSlab** (bjälklag/golv) som inkluderas i `wallTypes` och färgas svart — de täcker hela planets yta. Golv/bjälklag bör INTE vara svarta.

2. **Svarta kanter runt hela vyn** — Mobilens container (`MobileUnifiedViewer`) har `bg-black` på yttre div (rad 889) och `paddingTop: 'env(safe-area-inset-top)'` på 2D-panelen (rad 901). Divider-handtaget har `height: 20px` och `bg-card/90` — detta skapar en synlig svart rand. Dessutom tar safe-area-insets bort utrymme utan att fylla det.

3. **2D-planen fyller inte sin container** — Planen visas i `inline-block` med `transform-origin: 0 0` och initial scale 0.75, men centreringslogiken verkar inte köra korrekt, vilket lämnar svart/tomt utrymme runt bilden.

## Plan

### 1. Fixa svarta planytor — ta bort slab/golv från svartfärgning
**Fil:** `src/components/viewer/SplitPlanView.tsx` (rad 366)
- Ta bort `'ifcslab'` från `wallTypes`-setet. Slabs är golvytor som täcker hela planet — att färga dem svart gör hela planen svart.
- Behåll: `ifcwall`, `ifcwallstandardcase`, `ifccurtainwall`, `ifccolumn`, `ifcbeam` (dessa är tunna linjelement).
- Eventuellt ta bort `ifcrailing`, `ifcstair`, `ifcstairflight` om de orsakar stora svarta block.

### 2. Ta bort svarta kanter — fullscreen mobile layout
**Fil:** `src/pages/UnifiedViewer.tsx`
- Ändra `MobileUnifiedViewer` root-div:
  - Byt `bg-black` till `bg-background` (eller ta bort helt).
  - Ta bort `paddingTop: 'env(safe-area-inset-top)'` från 2D-panelen (rad 901) — istället låt planen använda hela höjden och overlay-knappar hantera safe area själva.
- Divider: Minska höjd från `20px` till `8px`, ta bort bakgrundsfärg eller gör den tunn och transparent.
- Se till att mode-switcher-overlay använder safe-area men inte tar bort yta från planen.

### 3. Fylla 2D-containern — auto-fit plan
**Fil:** `src/components/viewer/SplitPlanView.tsx`
- I centreringseffekten: beräkna `scale` dynamiskt så planen fyller containern (`contain`-logik istället för fast 0.75).
- Formeln: `scale = Math.min(containerW / imgW, containerH / imgH) * 0.95`
- Centrera med offset: `offsetX = (containerW - imgW * scale) / 2`, samma för Y.
- Bakgrundsfärg redan `#ffffff` — korrekt.

### 4. Tunnare divider (mobil)
**Fil:** `src/pages/UnifiedViewer.tsx`
- Byt divider-höjd till `8px` (från 20px).
- Gör griphandtaget subtilare (h-2 w-6, rounded-full, med tunn linje).
- Behåll touchStart-hitbox på hela elementet.

### Filer att ändra
- `src/components/viewer/SplitPlanView.tsx` — slab-fix, auto-fit centering
- `src/pages/UnifiedViewer.tsx` — fullscreen layout, tunnare divider

