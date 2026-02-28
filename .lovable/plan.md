

# Plan: Fem UI-korrigeringar för Native Xeokit Viewer

## Problem 1: A-modell-filter matchar allt (Brand laddas)
**Orsak:** Filtret `/^[0-9A-F]{8}-/i.test(id)` matchar UUID-format — och ALLA `model_id` i databasen är UUID:er. Filtret släpper igenom allt.

**Fix:** Ta bort UUID-matchningen. Filtrera istället på `model_name` — om inget namn finns eller om namnet börjar med "Brand", "V-", "EL-", "VS-" etc, exkludera modellen. Behåll bara modeller vars `model_name` börjar med `A-`, `A_`, `ARK`, eller är null/saknas (fallback: ladda om inget matchar).

**Fil:** `src/components/viewer/NativeXeokitViewer.tsx` (rad 168-175)

---

## Problem 2: Högerklickmeny ser "vit" ut — matchar inte dark theme
**Orsak:** `ViewerContextMenu` använder `bg-card/95` och `text-foreground` som i dark mode borde vara mörk, men den visas ovanpå viewern som har ljus bakgrund. Ingen explicit dark-mode-klass sätts.

**Fix:** Ge menyn en explicit mörk styling: `bg-zinc-900/95 text-zinc-100 border-zinc-700` istället för theme-variabler, så den alltid ser konsekvent ut oavsett viewer-bakgrund.

**Fil:** `src/components/viewer/ViewerContextMenu.tsx` (rad 105, 128, 160)

---

## Problem 3: Egenskaps-dialogrutan (Properties) — dålig responsivitet, svår att stänga
**Orsak:** `UniversalPropertiesDialog` och `AssetPropertiesDialog` är floating divs utan klickyta utanför för stängning. På mobil saknas tydlig stäng-knapp.

**Fix i UniversalPropertiesDialog:**
- Lägg till en halvtransparent backdrop (`fixed inset-0 bg-black/30`) som stänger dialogen vid klick
- Öka dialogens storlek men begränsa till max 90vw/90vh
- Gör stäng-knappen (X) större och mer synlig

**Fil:** `src/components/common/UniversalPropertiesDialog.tsx`

---

## Problem 4: Visualiseringslegend (temperatur etc) på fel sida
**Orsak:** `VisualizationLegendBar` placeras med `left-3`. Användaren vill ha den på höger sida med värdena på andra sidan av stapeln.

**Fix:** Ändra positionering till `right-3` istället för `left-3`. Byt ordning så gradient-bar är till vänster och värde-labels till höger (omvänd flex-ordning).

**Fil:** `src/components/viewer/VisualizationLegendBar.tsx` (rad 119-121, 126, 186)

---

## Problem 5: Våningsväljare (floor pills) krockar med navigationsmeny på mobil
**Orsak:** `FloatingFloorSwitcher` är vertikal med `left-3 top-[140px]` — som krockar med MobileNav-menyn.

**Fix:** På mobil, flytta floor-pills till `bottom-20 left-1/2 -translate-x-1/2` och gör dem horisontella (`flex-row` istället för `flex-col`).

**Fil:** `src/components/viewer/FloatingFloorSwitcher.tsx` (rad 270-275)

---

## Filer att ändra
1. `src/components/viewer/NativeXeokitViewer.tsx` — fix A-filter (ta bort UUID-match)
2. `src/components/viewer/ViewerContextMenu.tsx` — mörk explicit styling
3. `src/components/common/UniversalPropertiesDialog.tsx` — backdrop + responsivitet
4. `src/components/viewer/VisualizationLegendBar.tsx` — flytta till höger sida
5. `src/components/viewer/FloatingFloorSwitcher.tsx` — mobil positionering

