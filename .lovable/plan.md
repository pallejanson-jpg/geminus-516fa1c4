

# Plan: Flytta & ta bort objekt i 3D-viewern

## Bakgrund

xeokit SDK stöder `entity.offset = [dx, dy, dz]` för att dynamiskt förflytta objekt i 3D-scenen. Detta kräver att `entityOffsetsEnabled: true` sätts vid Viewer-initialisering. Funktionen är avsedd exakt för detta use case — förvaltningsflyttar där BIM-modellen inte uppdateras direkt.

## Övergripande flöde

```text
Högerklick objekt → "Flytta objekt" / "Ta bort objekt"
       │                        │
       ▼                        ▼
  Aktiverar drag-mode      Markerar som borttaget i DB
  Användaren drar objektet  Döljer entity i 3D (invisible)
  Släpper → ny position     Sparar status i assets-tabellen
       │
       ▼
  Detekterar nytt rum (AABB)
  Sparar offset + status i DB
  Uppdaterar in_room_fm_guid
```

## Implementation

### 1. Databas: Nya kolumner på `assets`

Migration som lägger till:
- `modification_status` text (null | 'moved' | 'deleted') — standard null = oförändrad
- `moved_offset_x`, `moved_offset_y`, `moved_offset_z` numeric — offset i modellkoordinater
- `original_room_fm_guid` text — rummet objektet kom ifrån (sparas vid flytt)
- `modification_date` timestamptz — när flytt/borttagning gjordes

### 2. Viewer: Aktivera entity offsets

I `NativeXeokitViewer.tsx`, lägg till `entityOffsetsEnabled: true` i Viewer-konstruktorn:
```js
const viewer = new sdk.Viewer({
  canvasElement: canvasRef.current,
  transparent: true,
  saoEnabled: true,
  entityOffsetsEnabled: true,  // NY
});
```

### 3. Ny hook: `useObjectMoveMode`

Hook som hanterar drag-flytt-logiken:
- Aktiveras via custom event `OBJECT_MOVE_MODE_EVENT`
- Lyssnar på `mousemove` + `mouseup` på canvas
- Beräknar delta i world-space via `scene.pick({ pickSurface: true })` vid start och under drag
- Uppdaterar `entity.offset` i realtid under drag
- Vid släpp: detekterar nytt rum via AABB-traversering i metaScene
- Sparar offset + `modification_status = 'moved'` + `original_room_fm_guid` + nytt `in_room_fm_guid` till `assets`-tabellen

### 4. Kontextmeny: Nya actions

Lägg till i `ContextMenuSettings.ts` och `ViewerContextMenu.tsx`:
- **"Flytta objekt"** (Move, ikon) — aktiverar drag-mode för valt objekt
- **"Ta bort objekt"** (Trash2, ikon) — markerar som borttaget

Ta bort-logiken:
- Sätter `modification_status = 'deleted'` i DB
- Om `created_in_model = true`: döljer entity (`entity.visible = false`)
- Om lokalt skapat: befintlig raderingslogik

### 5. Viewer Filter: "Visa borttagna" & "Visa flyttade"

I `ViewerFilterPanel.tsx`, ny sektion "Ändringsfilter":
- **Visa borttagna objekt** — toggle, hämtar assets med `modification_status = 'deleted'`, visar dem med röd färg (`entity.colorize = [1, 0.2, 0.2]`)
- **Visa flyttade objekt** — toggle, hämtar assets med `modification_status = 'moved'`, visar dem med orange färg (`entity.colorize = [1, 0.6, 0.1]`)
- Flyttade objekt behåller sin standardfärg i normalt läge (orange bara i filterläge)

### 6. Återställning vid modelluppdatering

När Asset+-synk uppdaterar ett objekt (ny `source_updated_at`): nollställ `modification_status`, offset-kolumner, och `original_room_fm_guid`. Detta sker i befintliga `asset-plus-sync`-funktionen.

### 7. Rapport-export

Ny knapp i Insights/Asset-fliken: "Exportera ändringsrapport" — genererar CSV/tabell med alla objekt som har `modification_status != null`, med kolumner: Objekt, Typ, Rum (från), Rum (till), Status, Datum.

### 8. Buggfix: Select-verktyget i högerklickmenyn

Nuvarande `select`-item i kontextmenyn har ingen implementation. Lägg till `onSelectEntity`-handler i `NativeViewerShell.tsx` som sätter `entity.selected = true` och dispatchar selection-event.

## Filer att ändra

| Fil | Ändring |
|-----|---------|
| Migration SQL | Nya kolumner på `assets` |
| `NativeXeokitViewer.tsx` | `entityOffsetsEnabled: true` |
| `src/hooks/useObjectMoveMode.ts` | **Ny** — drag-flytt-logik |
| `ViewerContextMenu.tsx` | Flytta + Ta bort actions |
| `ContextMenuSettings.ts` | Nya menu items |
| `NativeViewerShell.tsx` | Wire up nya context actions + select-fix |
| `ViewerFilterPanel.tsx` | Ändringsfilter-sektion |
| `asset-plus-sync` edge function | Nollställ modification_status vid uppdatering |

## Tekniska detaljer

- **xeokit offset API**: `entity.offset = [dx, dy, dz]` — fungerar per entity, kräver `entityOffsetsEnabled: true`
- **Rumsdetektering vid flytt**: Traversera metaScene för IfcSpace-entiteter, testa om ny position (original + offset) ligger inom space AABB
- **Persistens**: Offsets sparas i DB och appliceras vid modell-laddning via en `useEffect` i `NativeXeokitViewer` som läser assets med `modification_status = 'moved'` och applicerar `entity.offset`
- **Borttagna objekt**: Appliceras vid laddning — entiteter med `modification_status = 'deleted'` sätts till `visible = false`

