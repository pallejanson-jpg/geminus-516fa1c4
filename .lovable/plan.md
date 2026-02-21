

## Ändra 2D-läget till Xeokit 2D + Ta bort Split 2D/3D

### Vad ändras

1. **2D-knappen i mode-switchern** visar nu xeokit-viewern i 2D-läge (ortografisk planvy med dolda bjälklag) istället för FM Access 2D-ritning
2. **Split 2D/3D-knappen** tas bort helt
3. FM Access 2D-ritningen finns kvar i koden men visas inte längre via mode-switchern (kan användas på andra ställen i framtiden)

### Ny flikordning

```text
[ 2D ] [ 3D ] [ Split 3D/360 ] [ VT ] [ 360° ]
```

### Teknisk implementation

**Fil: `src/pages/UnifiedViewer.tsx`**

- Ta bort `'split2d'` från `ViewMode`-typen: `'2d' | '3d' | 'split' | 'vt' | '360'`
- Ta bort `isSplit2DMode`-variabeln och all logik kopplad till den
- Ta bort Split 2D/3D `ModeButton`
- Ta bort FM Access 2D-panel-renderingen för `isSplit2DMode` (rad 500-512)
- Ta bort FM Access 2D-panel-renderingen för `is2DMode` (rad 517-529)
- Ändra `needs3D`: ta bort `viewMode !== '2d'`-villkoret -- 2D behöver nu 3D-viewern (xeokit) synlig
- När `viewMode` sätts till `'2d'`, dispatcha en custom event som triggar ViewerToolbar att aktivera 2D-läget (ortho + dolda bjälklag)
- När `viewMode` lämnar `'2d'`, dispatcha en event som återställer till 3D-läge

**Fil: `src/lib/viewer-events.ts`**

- Lägg till `VIEW_MODE_2D_TOGGLED_EVENT` med detail `{ enabled: boolean }` för kommunikation mellan UnifiedViewer och ViewerToolbar
- Ta bort `SPLIT_2D_FLOOR_SYNC_EVENT` (oanvänd nu)

**Fil: `src/components/viewer/ViewerToolbar.tsx`**

- Lyssna på `VIEW_MODE_2D_TOGGLED_EVENT` -- när `enabled: true`, kör samma logik som 2D-knappen i toolbaren (setShowFloorplan, setNavMode, dolda IFC-typer, ortho-projektion)
- När `enabled: false`, återställ till 3D (perspektiv, visa dolda objekt)
- Dölj den inbyggda 2D/3D-toggle-knappen i toolbaren om den triggas externt (valfritt -- kan också behållas för konsistens)

### Flöde

```text
Användare klickar "2D" i mode-switcher
  -> UnifiedViewer sätter viewMode = '2d'
  -> xeokit-containern förblir synlig (needs3D = true)
  -> Dispatchar VIEW_MODE_2D_TOGGLED_EVENT { enabled: true }
  -> ViewerToolbar tar emot eventet
  -> Aktiverar ortho-projektion, setShowFloorplan, döljer bjälklag/tak
  
Användare klickar "3D" i mode-switcher
  -> UnifiedViewer sätter viewMode = '3d'
  -> Dispatchar VIEW_MODE_2D_TOGGLED_EVENT { enabled: false }
  -> ViewerToolbar återställer perspektiv, visar dolda objekt
```

### Filer som ändras

1. `src/pages/UnifiedViewer.tsx` -- Ta bort split2d, ändra 2D till xeokit-baserat
2. `src/lib/viewer-events.ts` -- Lägg till VIEW_MODE_2D_TOGGLED_EVENT, ta bort SPLIT_2D_FLOOR_SYNC_EVENT
3. `src/components/viewer/ViewerToolbar.tsx` -- Lyssna på externt 2D-toggle-event

