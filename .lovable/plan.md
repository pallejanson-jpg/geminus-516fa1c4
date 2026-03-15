

## Rekommendation: Hybrid (Alternativ 3)

**Drawer-wrapper + befintlig logik** är det klart bästa valet för Viewer-komponenten. Här är varför:

### Varför inte Alternativ 1 (bara förbättra responsivitet)?
Problemet med VisualizationToolbar är inte CSS-marginaler — det är att en **288px sidebar på en 314px skärm** är fundamentalt fel arkitektur. Ingen mängd `max-w` eller `overflow` fixar att sidopanelen tar 92% av skärmbredden. Det kräver en annan container-typ (Drawer).

### Varför inte Alternativ 2 (helt egna mobila skärmar)?
Viewer-logiken är **betydligt mer komplex** än Inventory-wizarden. VisualizationToolbar har ~1300 rader med issue-hantering, BCF-viewpoints, färgläggning, rumsvisualisering, etc. Att duplicera den logiken i en separat mobil-komponent skapar en underhållsmardröm och tar veckor.

### Varför Alternativ 3 (Hybrid)?
- **Samma affärslogik** — inga duplicerade issue-handlers, BCF-saves, visualiseringsberäkningar
- **Mobil-native containers** — Drawer från botten istället för sidebar, Sheet istället för SidePopPanel
- **Mönstret finns redan** — `MobileViewerPage.tsx` är redan en hybrid-wrapper som återanvänder `NativeViewerShell`
- **Snabbt att implementera** — 5 filer, primärt wrapper-logik med `useIsMobile()`

### Konkret approach per komponent

| Komponent | Desktop (oförändrad) | Mobil (ny wrapper) |
|-----------|---------------------|-------------------|
| VisualizationToolbar | Fast höger-sidebar 288px | Bottom Drawer, max 75dvh |
| SidePopPanel | Positionerad panel 220px | Full-bredd Sheet från botten |
| ViewerToolbar settings | Popover uppåt | Drawer eller scrollbar Popover |
| Floor overflow | Popover vänster | Popover uppåt med max-height |
| RoomVisualization | Dragbar floating panel | Bottom Drawer |

Varje komponent behåller sin inre logik intakt — vi byter bara **yttre container** baserat på `useIsMobile()`.

