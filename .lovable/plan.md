
# Plan: Förbättra BCF-ärenden med Objektselektion

## Sammanfattning

Säkerställa att selekterade objekt verkligen fångas, visas och highlightas korrekt genom hela ärendeflödet - från skapande till visning.

---

## Nulägesanalys

### Vad som redan fungerar

| Komponent | Status | Beskrivning |
|-----------|--------|-------------|
| `useBcfViewpoints.captureViewpoint()` | Fungerar | Fångar `scene.selectedObjectIds` och sparar i `viewpoint.components.selection` |
| `getSelectedObjectIds()` | Fungerar | Hämtar aktuella selektioner från scenen |
| `handleSubmitIssue()` | Fungerar | Sparar `selected_object_ids` i databasen |
| `restoreViewpoint()` | Delvis | Återställer selektion via `setObjectsSelected()` men utan visuell feedback |

### Problem att lösa

1. **Ingen visuell feedback vid återställning** - Objektet selekteras men användaren ser ingen tydlig highlight
2. **Användaren ser inte vad som fångas** - I `CreateIssueDialog` visas inte vilka objekt som är markerade
3. **Ingen objektinfo i detaljvyn** - `IssueDetailSheet` visar inte vilka objekt ärendet gäller

---

## Lösning

### Del 1: Flash-effekt vid viewpoint-återställning

Utöka `restoreViewpoint()` i `useBcfViewpoints.ts` för att returnera de valda objekten så att anroparen kan trigga en flash-effekt.

Alternativt: Lägg till flash direkt i `restoreViewpoint()` men det kräver att vi skickar in `flashEntitiesByIds`-funktionen.

**Rekommenderad approach**: Uppdatera `handleGoToIssueViewpoint` i `VisualizationToolbar.tsx` för att:
1. Anropa `restoreViewpoint()`
2. Efter kamera-animationen (1 sekund), anropa `flashEntitiesByIds()` med de selekterade objekten

```typescript
const handleGoToIssueViewpoint = useCallback((viewpoint: any) => {
  if (!viewpoint) return;
  
  restoreViewpoint(viewpoint, { duration: 1.0 });
  
  // Flash the selected objects after camera animation completes
  if (viewpoint.components?.selection?.length > 0) {
    const selectedIds = viewpoint.components.selection.map((s: any) => s.ifc_guid);
    setTimeout(() => {
      const xeokitViewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      if (xeokitViewer?.scene) {
        flashEntitiesByIds(xeokitViewer.scene, selectedIds, { duration: 3000 });
      }
    }, 1100); // Slightly after camera animation
  }
}, [restoreViewpoint, viewerRef]);
```

---

### Del 2: Visa selekterade objekt i CreateIssueDialog

Skicka med information om selekterade objekt och visa dem i dialogrutan så användaren vet exakt vad som fångas.

**Uppdatera `CreateIssueDialogProps`:**
```typescript
interface CreateIssueDialogProps {
  // ... existing props
  selectedObjectCount?: number;  // Antal selekterade objekt
  selectedObjectIds?: string[];  // För att visa i UI
}
```

**Lägg till i dialogens UI:**
```tsx
{/* Selected objects indicator */}
{selectedObjectIds && selectedObjectIds.length > 0 && (
  <div className="flex items-center gap-2 p-2 rounded-md bg-primary/10 text-sm">
    <Box className="h-4 w-4 text-primary" />
    <span>
      {selectedObjectIds.length} {selectedObjectIds.length === 1 ? 'objekt valt' : 'objekt valda'}
    </span>
  </div>
)}
```

---

### Del 3: Visa objektinfo i IssueDetailSheet

Hämta `selected_object_ids` från ärendet och visa dem som en lista eller badge.

**Uppdatera `BcfIssue`-typen:**
```typescript
interface BcfIssue {
  // ... existing fields
  selected_object_ids: string[] | null;
}
```

**Lägg till i detaljvyns UI:**
```tsx
{/* Selected objects */}
{issue.selected_object_ids && issue.selected_object_ids.length > 0 && (
  <div>
    <h4 className="text-sm font-medium mb-1 flex items-center gap-2">
      <Box className="h-4 w-4" />
      Relaterade objekt
    </h4>
    <div className="flex flex-wrap gap-1">
      {issue.selected_object_ids.map((id) => (
        <Badge key={id} variant="outline" className="text-xs font-mono">
          {id.substring(0, 12)}...
        </Badge>
      ))}
    </div>
  </div>
)}
```

---

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/hooks/useBcfViewpoints.ts` | Exportera `getXeokitViewer` eller lägg till flash-callback |
| `src/components/viewer/VisualizationToolbar.tsx` | Lägg till flash-effekt i `handleGoToIssueViewpoint`, skicka med selectedObjectIds till dialog |
| `src/components/viewer/CreateIssueDialog.tsx` | Visa antal/lista av selekterade objekt |
| `src/components/viewer/IssueDetailSheet.tsx` | Visa selekterade objekt, anropa flash vid "Gå till position" |
| `src/components/viewer/IssueListPanel.tsx` | Uppdatera `BcfIssue`-typen att inkludera `selected_object_ids` |

---

## Tekniska detaljer

### Flash-timing

```text
1. Användare klickar "Gå till position"
2. restoreViewpoint() anropas med duration: 1.0s
3. Kameran flyger till positionen (1 sekund)
4. Efter 1.1s: flashEntitiesByIds() triggas
5. Objekten blinkar i 3 sekunder med röd färg
6. Färgen återställs automatiskt
```

### Integration med useFlashHighlight

Hooken `useFlashHighlight` finns redan och har:
- `flashEntitiesByIds(scene, entityIds, options)` - Flash flera objekt
- Automatisk cleanup och färgåterställning
- Konfigurerbar duration och färger

---

## Testning

1. **Selektera objekt före ärende**: Välj ett objekt i 3D-viewern → Klicka "Skapa ärende" → Verifiera att dialogen visar "1 objekt valt"
2. **Flash vid återställning**: Öppna ett ärende med selekterat objekt → Klicka på skärmdumpen → Verifiera att kameran flyger dit OCH objektet blinkar rött
3. **Objektvisning i detalj**: Öppna ett ärende → Verifiera att "Relaterade objekt" visas med objekt-ID:n
4. **Inget objekt selekterat**: Skapa ärende utan selektion → Verifiera att ingen "objekt valt"-ruta visas
