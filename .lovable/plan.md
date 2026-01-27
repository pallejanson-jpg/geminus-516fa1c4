
# Plan: Fixa VisualizationToolbar så Sheet-menyn öppnas

## Problem
Sheet-panelen öppnas inte när man klickar på menyknappen (tre punkter). Endast tooltip-texten "Visning" visas vid hover.

## Orsak
`SheetTrigger asChild` och `TooltipTrigger asChild` är nästlade på ett sätt som skapar konflikt. Tooltip-komponenten fångar klickhändelsen och förhindrar att Sheet öppnas.

Nuvarande struktur:
```
SheetTrigger asChild
  └── TooltipProvider
        └── Tooltip
              └── TooltipTrigger asChild
                    └── Button  ← Klick når aldrig SheetTrigger
```

## Lösning
Förenkla strukturen genom att ta bort Tooltip-wrappern helt. Knappen får en `title`-attribut för enkel hover-text istället.

Ny struktur:
```
SheetTrigger asChild
  └── Button (title="Visning")  ← Klick når SheetTrigger direkt
```

## Ändringar

**Fil: `src/components/viewer/VisualizationToolbar.tsx`**

1. Ta bort Tooltip-importerna (TooltipProvider, Tooltip, TooltipTrigger, TooltipContent)
2. Ersätt den nästlade strukturen med enkel Button direkt i SheetTrigger
3. Lägg till `title="Visning"` på Button för hover-text

Resultat: Två fungerande toggles (Visa rum, Visa annotationer) i en sidopanel som öppnas korrekt.
