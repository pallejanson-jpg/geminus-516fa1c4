

# Plan: Glas i teman, Rumsvisualisering som lista, Våningsklipp från Portfolio

## 1. Lägg till "Glas" som IFC-kategori i teman

**Fil:** `src/components/settings/ViewerThemeSettings.tsx`
- Lägg till `{ key: 'ifcplate', label: 'Glas', defaultColor: '#B8D4E3' }` i `IFC_CATEGORIES` (IfcPlate är den vanligaste IFC-typen för glaspaneler). Lägg även till `ifccurtainwall` som alias.
- Sätt default opacity till `0.3` för glastyper.

**Fil:** `src/hooks/useViewerTheme.ts` — `applyTheme`
- Utvidga opacity-logiken (rad 190-195) så att opacity tillämpas på **alla** typer som har `mapping.opacity` satt, inte bara `ifcspace`. Detta gör att glas kan vara transparent.

Ändring:
```typescript
// Nuvarande: opacity bara för ifcspace
// Nytt: opacity för alla typer som har det definierat
if (mapping.opacity !== undefined) {
  entity.opacity = mapping.opacity;
} else if (ifcType === 'ifcspace') {
  entity.opacity = theme.space_opacity ?? 0.25;
}
```

## 2. Visa rumsvisualiseringar som lista istället för bara en switch

**Fil:** `src/components/viewer/VisualizationToolbar.tsx` (rad 839-849)
- Byt ut den enkla Switch-raden mot en inline-lista med de 5 visualiseringstyperna (Temperatur, CO₂, Luftfuktighet, Beläggning, Yta).
- Varje typ visas som en klickbar rad med ikon och namn. Klick togglar visualiseringen via `VISUALIZATION_QUICK_SELECT_EVENT`.
- Behåll den befintliga `onToggleVisualization` för att visa/dölja `RoomVisualizationPanel`, men trigga den automatiskt vid val.

Struktur:
```
Rumsvisualisering
  🌡️ Temperatur    [aktiv-markering]
  💨 CO₂
  💧 Luftfuktighet
  👥 Beläggning
  📐 Yta (NTA)
```

## 3. Våningsklipp vid val i Portfolio

**Fil:** `src/components/portfolio/FacilityLandingPage.tsx`
- `handleToggle3D` och `handleToggle2D` skickar redan `&floor={fmGuid}` som URL-param vid storey-navigering.

**Fil:** `src/pages/UnifiedViewer.tsx`
- Koden dispatchar redan `FLOOR_SELECTION_CHANGED_EVENT` med `isSoloFloor: true` och `visibleFloorFmGuids: [floorFmGuid]` (rad 206-216, 221-231).
- **Problemet**: `visibleMetaFloorIds` skickas som tom array `[]`. Utan dessa kan `useSectionPlaneClipping` inte hitta rätt höjd att klippa på.

**Fix i `UnifiedViewer.tsx`**: När `floorFmGuid` finns, matcha det mot `sharedFloors` (från `useFloorData`) för att fylla `visibleMetaFloorIds` med xeokit metaObjectIds. Uppdatera alla 3 ställen där `FLOOR_SELECTION_CHANGED_EVENT` dispatcas med `floorFmGuid`.

**Fix i `NativeViewerShell.tsx`**: Säkerställ att `useSectionPlaneClipping` är kopplad och lyssnar på `FLOOR_SELECTION_CHANGED_EVENT` för att faktiskt applicera klippningen.

## Sammanfattning

| Fil | Ändring |
|-----|---------|
| `ViewerThemeSettings.tsx` | Lägg till `ifcplate`/`ifccurtainwall` i `IFC_CATEGORIES` med opacity 0.3 |
| `useViewerTheme.ts` | Utvidga opacity-logik till alla typer (inte bara ifcspace) |
| `VisualizationToolbar.tsx` | Ersätt Switch med klickbar lista av visualiseringstyper |
| `UnifiedViewer.tsx` | Fyll `visibleMetaFloorIds` vid dispatch av floor-event |
| `NativeViewerShell.tsx` | Koppla `useSectionPlaneClipping` till floor-events |

