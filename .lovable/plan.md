

## Plan: Filterpanelens cleanup ska respektera aktivt viewer-tema

### Problem
När filterpanelen stängs anropas `setObjectsColorized(ids, false)` som tar bort all färg — resultatet blir råa IFC-färger. Förra planen föreslog att alltid anropa `applyArchitectColors()`, men det är fel om användaren valt ett annat tema (t.ex. "Geminus" eller "Model Native Colour").

### Lösning
Filterpanelens cleanup ska **återapplicera det aktiva temat**, eller falla tillbaka på `applyArchitectColors()` (="Standard") om inget tema är valt.

### Teknisk ändring

**`src/components/viewer/ViewerFilterPanel.tsx`**

1. **Lägg till lyssnare för `VIEWER_THEME_CHANGED_EVENT`** — spara `activeThemeId` i en ref så cleanup vet vilket tema som gäller.

2. **Uppdatera cleanup-effekten (rad 1206-1219)**:
   ```
   // Efter befintlig reset (xray, colorize, visibility, opacity):
   
   // Re-apply active theme or default architect colors
   if (activeThemeIdRef.current) {
     window.dispatchEvent(new CustomEvent(VIEWER_THEME_REQUESTED_EVENT, {
       detail: { themeId: activeThemeIdRef.current }
     }));
   } else {
     applyArchitectColors(viewer);
   }
   
   // Always hide IfcSpace objects (standard behavior)
   hideSpaceAndAreaObjects(viewer);
   ```

3. **Importera** `VIEWER_THEME_CHANGED_EVENT` och `VIEWER_THEME_REQUESTED_EVENT` från `useViewerTheme`, samt `hideSpaceAndAreaObjects` från `useFloorVisibility`.

### Flöde
- Användare öppnar filterpanelen → filter appliceras
- Användare stänger filterpanelen → cleanup körs → dispatchar `VIEWER_THEME_REQUESTED_EVENT` med aktivt tema-ID
- `ViewerThemeSelector` lyssnar redan på `VIEWER_THEME_REQUESTED_EVENT` och applicerar temat
- Om inget tema är aktivt → `applyArchitectColors()` körs (= "Standard"-beteende)
- IfcSpace-objekt döljs alltid efter cleanup

### Filer som ändras
- `src/components/viewer/ViewerFilterPanel.tsx` — cleanup-logik + event-lyssnare

