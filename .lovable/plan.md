

# Plan: Standard-tema = Arkitektfärger, Room Labels-fix, Bakgrundsfärg-fix

## 1. Kopiera arkitektvy-inställningar till "Standard"-temat

Uppdatera DB-raden `viewer_themes` där `name = 'Standard'` så att `color_mappings` och `edge_settings` matchar "Arkitektvy"-temat. Sedan är arkitektfärgerna standard, tillämpade automatiskt vid modelladdning.

**Migration SQL:**
```sql
UPDATE viewer_themes 
SET color_mappings = (SELECT color_mappings FROM viewer_themes WHERE name = 'Arkitektvy'),
    edge_settings = (SELECT edge_settings FROM viewer_themes WHERE name = 'Arkitektvy'),
    space_opacity = (SELECT space_opacity FROM viewer_themes WHERE name = 'Arkitektvy')
WHERE name = 'Standard';
```

## 2. Room labels — fungerar bara första gången

**Orsak:** När labels stängs av anropas `destroyLabels()` som rensar kamera-lyssnare och label-element — men `containerRef` pekar fortfarande på ett DOM-element som kan ha blivit avkopplat om canvas-föräldraelementet har ändrats (t.ex. vid vy-byte). Vid andra toggle ON hittar `ensureContainer()` den gamla referensen men den kan vara orphaned.

**Fix i `useRoomLabels.ts`:**
- I `destroyLabels`: ta även bort container-elementet och nollställ `containerRef.current = null` — inte bara vid unmount. Då skapas en ny container varje toggle-cykel.
- Alternativt: validera att container fortfarande är connected (`containerRef.current?.isConnected`) i `ensureContainer`.

## 3. Bakgrundsfärg fungerar inte + sätt default till grå

**Problem 1 — Default bakgrund:** `NativeViewerShell` har redan `style={{ background: 'linear-gradient(180deg, #f5f5f5 0%, #e8e8e8 100%)' }}` — detta är en subtil grå gradient. Om användaren vill ha tydligare grå, ändra till `light-gray`-preseten: `rgb(230,230,230)`.

**Problem 2 — Färgväljaren fungerar inte:** `NativeViewerShell` lyssnar på `ARCHITECT_BACKGROUND_CHANGED_EVENT` och söker `.native-viewer-canvas-parent`. Eventen dispatchas av VisualizationToolbar/ViewerRightPanel. Men dessa paneler kanske inte renderas (de renderas bara i icke-native viewer-kontexten). Om det är NativeViewerShell som renderar verktygsfältet, behöver bakgrundsfärg-väljaren finnas i `ViewerToolbar` eller i `VisualizationToolbar` som renderas av NativeViewerShell.

**Fix:**
- Verifiera att `VisualizationToolbar` renderas i `NativeViewerShell` med bakgrundsfärg-stöd
- Sätt standard bakgrundspresets-state till `'light-gray'` istället för `'sage'` i `useArchitectViewMode`
- Uppdatera inline-style i NativeViewerShell till `light-gray` gradient

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| Migration SQL | Kopiera Arkitektvy-mappings till Standard-tema |
| `src/hooks/useRoomLabels.ts` | Fix destroyLabels: nollställ containerRef |
| `src/hooks/useArchitectViewMode.ts` | Default preset → `'light-gray'` |
| `src/components/viewer/NativeViewerShell.tsx` | Uppdatera default gradient till light-gray |

