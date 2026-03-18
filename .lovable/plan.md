

## Plan: In-Viewer Inventory via befintlig InventoryFormSheet

Återanvänder `InventoryFormSheet` (som redan wrappar `InventoryForm`) istället för att skapa en ny komponent. Flödet: högerklick → "Create Asset" → position-pick-läge → klick i viewern fångar 3D-koordinater → InventoryFormSheet öppnas med prefilled position.

---

### 1. Context menu: Lägg till "Create Asset"

**`ContextMenuSettings.ts`** — Ny rad:
```ts
{ id: 'createAsset', label: 'Create asset', visible: true, group: 'geminus' }
```

**`ViewerContextMenu.tsx`** — Ny prop `onCreateAsset`, ny menyrad med `ClipboardPlus`-ikon. Alltid aktiverad (kräver inte entity).

---

### 2. Position-pick-läge i NativeViewerShell

**`NativeViewerShell.tsx`**:

- Nytt state: `isPickingPosition`, `pendingAssetPosition`, `showInventorySheet`.
- `handleCreateAsset` (från context menu): sätter `isPickingPosition = true`, ändrar cursor till crosshair.
- I befintlig canvas click-handler: om `isPickingPosition`, kör `scene.pick({ pickSurface: true, canvasPos })` → spara `worldPos` i `pendingAssetPosition` → öppna `InventoryFormSheet` → avsluta pick-mode.
- Rendera `InventoryFormSheet` med props:
  - `buildingFmGuid` (redan tillgänglig)
  - `pendingPosition` = `pendingAssetPosition`
  - `onPickPositionRequest` = sätter `isPickingPosition = true` igen (för omval)
  - `isPickingPosition`
- Skicka med `onClose` som nollställer allt.

---

### 3. Flagga `created_in_model = false`

**`InventoryForm.tsx`** — I `handleSubmit`, sätt `created_in_model: false` (inte `true`) vid insert. Objekten som skapas via inventering är inte ritade i BIM-modellen.

Kontrollera att detta även gäller `QuickRegistrationStep.tsx` (mobil-wizard) — sätt `created_in_model: false` där också.

---

### 4. Annotation-refresh efter spara

**`InventoryFormSheet.tsx`** — I `handleSaved`, dispatcha `ANNOTATION_REFRESH_EVENT` så att den nya symbolen/markören dyker upp direkt i viewern utan reload.

---

### 5. Mobil: Create Asset-knapp

**`MobileViewerOverlay.tsx`** — Lägg till en "+" knapp i bottom toolbar som triggar samma `isPickingPosition`-flow via event (`VIEWER_CREATE_ASSET_EVENT`).

---

### Filändringar

| Fil | Ändring |
|-----|---------|
| `ContextMenuSettings.ts` | Ny `createAsset` item |
| `ViewerContextMenu.tsx` | Ny `onCreateAsset` prop + menyrad |
| `NativeViewerShell.tsx` | Pick-mode state, canvas handler, rendera `InventoryFormSheet` |
| `InventoryForm.tsx` | `created_in_model: false` vid insert |
| `QuickRegistrationStep.tsx` | `created_in_model: false` vid insert |
| `InventoryFormSheet.tsx` | Dispatcha annotation refresh vid spara |
| `MobileViewerOverlay.tsx` | Create Asset-knapp |
| `viewer-events.ts` | Nytt event `VIEWER_CREATE_ASSET_EVENT` |

