

## Ny Split 2D/3D-vy + Omordnad Mode-switcher

### Sammanfattning

1. Flytta 2D-fliken till vänster om 3D i mode-switchern
2. Lägg till ett nytt "Split 2D/3D"-läge som visar FM Access 2D-ritning bredvid xeokit 3D-modell med synkroniserade kameror
3. Visningsmeny (rum-labels, visualiseringar) aktiv i 3D-panelen i split-läget

### Tekniskt beslut: Vilken 2D?

En xeokit-canvas kan bara visa EN projektion (ortho ELLER perspektiv) samtidigt. Att visa xeokit i 2D-läge OCH 3D-läge kräver två separata viewer-instanser, vilket är tungt och bryter mot arkitekturen ("only ONE AssetPlusViewer instance").

Lösningen: **FM Access 2D-ritning** (vänster) + **xeokit 3D** (höger) -- exakt samma mönster som befintlig Split 3D/360 men med 2D-panelen istället för Ivion SDK.

### Ny flikordning i mode-switchern

```text
Nuvarande:  [ 3D ] [ Split ] [ VT ] [ 360° ] [ 2D ]
Ny:         [ 2D ] [ Split 2D/3D ] [ 3D ] [ Split 3D/360 ] [ VT ] [ 360° ]
```

- **2D** -- FM Access 2D-ritning (befintlig)
- **Split 2D/3D** -- NY: 2D + 3D sida vid sida
- **3D** -- xeokit 3D (befintlig)
- **Split 3D/360** -- Befintlig split (omdöpt för tydlighet)
- **VT** -- Virtual Twin (befintlig)
- **360°** -- Enbart panorama (befintlig)

### Kamerasynk i Split 2D/3D

- **3D till 2D**: När användaren navigerar i 3D (byter våning, klickar rum), skickas `floorFmGuid` till FM Access 2D-panelen som växlar till rätt våning
- **2D till 3D**: När användaren klickar ett rum i FM Access 2D, dispatchar vi en event som 3D-viewern lyssnar på för att flyga till rummet (`flyToCoordinates` eller `lookAtInstanceFromAngle`)
- Synk sker via `ViewerSyncContext` som redan finns och redan hanterar 3D/360-synk

### Visningsmeny i split-läget

ViewerToolbar (rum-labels, visualiseringar, x-ray etc.) renderas inuti AssetPlusViewer och är redan aktiv i befintliga split-lägen. Den kommer automatiskt vara tillgänglig i 3D-panelen av Split 2D/3D. FM Access 2D-panelen har sin egen inbyggda kontrollpanel.

### Implementation -- Filer som ändras

**1. `src/pages/UnifiedViewer.tsx`**

- Lägg till `ViewMode`-typ: `'split2d'`
- Uppdatera mode-switchern (rad 371-378):
  - Flytta 2D-knappen först
  - Lägg till ny Split 2D/3D-knapp
  - Omdöp befintlig Split till "Split 3D/360"
- Lägg till `isSplit2DMode = viewMode === 'split2d'` logik
- Uppdatera `viewerContainerStyle`: width 50% för `split2d`
- Rendera FM Access 2D-panel på vänster halva när `split2d` aktiv
- Uppdatera `needs3D` att inkludera `split2d`
- Uppdatera subtitle-text och tooltip
- Mobilvy: lägg till Split 2D/3D som alternativ

**2. `src/components/viewer/FmAccess2DPanel.tsx`**

- Lägg till en `onRoomClick`-callback-prop som dispatchar rum-navigering till 3D
- Exponera `floorId` som dynamisk prop (redan finns) för synk från 3D

**3. `src/components/viewer/ViewerToolbar.tsx`**

- Exportera `ViewMode`-typen uppdaterad med `'split2d'`
- Inga andra ändringar behövs -- toolbaren fungerar redan i split-lägen

**4. `src/lib/viewer-events.ts`**

- Lägg till `SPLIT_2D_FLOOR_SYNC_EVENT` för att synka våningsval mellan panelerna

### Desktop-layout för Split 2D/3D

```text
+-----------------------------+-----------------------------+
|                             |                             |
|   FM Access 2D-ritning      |   xeokit 3D-modell          |
|   (50% bredd)               |   (50% bredd)               |
|                             |   [ViewerToolbar aktiv]     |
|                             |   [RoomLabels, X-ray etc.]  |
|                             |                             |
+-----------------------------+-----------------------------+
```

### Mobil-layout

På mobil visas inte split-läget (för liten skärm). Användaren kan växla mellan 2D och 3D via tabbar som idag.

### Implementationsordning

1. Uppdatera `ViewMode`-typ och mode-switcher i UnifiedViewer
2. Lägg till split2d-layout (CSS: 50/50 med FmAccess2DPanel + AssetPlusViewer)
3. Implementera våningssynk (3D floor-change dispatchar event, 2D lyssnar)
4. Implementera rum-klick-synk (2D rum-klick navigerar 3D)
5. Testa på desktop och mobil

