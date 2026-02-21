

## ✅ Ändra 2D-läget till Xeokit 2D + Ta bort Split 2D/3D

**Status: Implementerat**

### Vad ändrades

1. **2D-knappen i mode-switchern** visar nu xeokit-viewern i 2D-läge (ortografisk planvy med dolda bjälklag) istället för FM Access 2D-ritning
2. **Split 2D/3D-knappen** borttagen
3. FM Access 2D-ritningen finns kvar i koden men visas inte längre via mode-switchern

### Ny flikordning

```text
[ 2D ] [ 3D ] [ Split 3D/360 ] [ VT ] [ 360° ]
```

### Filer som ändrades

1. `src/pages/UnifiedViewer.tsx` — Borttaget split2d, 2D använder xeokit, dispatchar VIEW_MODE_2D_TOGGLED_EVENT
2. `src/lib/viewer-events.ts` — Lagt till VIEW_MODE_2D_TOGGLED_EVENT, borttaget SPLIT_2D_FLOOR_SYNC_EVENT
3. `src/components/viewer/ViewerToolbar.tsx` — Lyssnar på externt 2D-toggle-event
