

## Plan: Synka mobila menyn med desktop-högermenyn

Desktopens ViewerRightPanel har dessa sektioner som saknas eller är ofullständiga i mobilens Action Sheet (MobileViewerPage):

### Saknas i mobil

| Desktop-funktion | Mobil-status |
|---|---|
| **Floors** (FloorVisibilitySelector, multi-select) | Bara enkel floor-pill popover |
| **BIM Models** (ModelVisibilitySelector) | Saknas helt |
| **Show spaces** toggle | Saknas |
| **Minimap** toggle | Saknas |
| **Annotations** toggle + kategorier | Saknas |
| **Color filter** (RoomVisualizationPanel) | Menyrad "Visualization" finns men dispatchar bara event — ingen inline-panel |
| **Create view** / **Set start view** | Saknas |
| **Show Issues** toggle | Menyrad "Issues" finns men öppnar bara lista, ingen toggle |
| **Show Alarms** toggle | Saknas |
| **Show Sensors** toggle | Saknas |
| **Register asset** | Saknas (+ knapp finns i MobileViewerOverlay men inte i drawer) |
| **Clip height** slider | Saknas |
| **Room labels** config | Saknas |
| **Theme** selector | Saknas |
| **Lighting** controls | Saknas |

### Implementering

**Fil:** `src/components/viewer/mobile/MobileViewerPage.tsx`

Utöka Action Sheet-drawern med nya sub-sheets som speglar desktopens sektioner:

1. **Ny sub-sheet: "Display"** — innehåller:
   - BIM Models (ModelVisibilitySelector med `listOnly`)
   - Show spaces switch
   - Minimap switch
   - Annotations switch + AnnotationCategoryList
   - Show Issues / Alarms / Sensors switches

2. **Ny sub-sheet: "Color filter"** — renderar `RoomVisualizationPanel` inline i drawern

3. **Ny sub-sheet: "Actions"** — innehåller:
   - Create view (anropar `captureViewpoint`/`captureScreenshot`)
   - Set start view
   - Create issue
   - Register asset

4. **Ny sub-sheet: "Settings"** — innehåller:
   - Clip height slider
   - Room labels config (useRoomLabelConfigs)
   - ViewerThemeSelector
   - LightingControlsPanel

5. **Uppdatera MENU_ITEMS** — byt ut nuvarande lista till:
   ```
   View Mode | Display | Color filter | Actions | Insights | Settings
   ```
   (ta bort "Filter", "Visualization", "Issues" som separata — de ingår nu i Display/Actions)

### Filändringar

| Fil | Ändring |
|---|---|
| `MobileViewerPage.tsx` | Nya sub-sheets för Display, Color filter, Actions, Settings med alla desktop-verktyg. Importera ModelVisibilitySelector, AnnotationCategoryList, RoomVisualizationPanel, ViewerThemeSelector, LightingControlsPanel, CreateViewDialog, CreateIssueDialog. Lägg till nödvändiga states och event-dispatchers. |

