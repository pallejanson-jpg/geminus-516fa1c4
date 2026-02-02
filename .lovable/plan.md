
# Plan: Flyttbara ärende-komponenter

## Sammanfattning

Göra två BCF-relaterade komponenter flyttbara (draggable):

1. **Ärendelistan** - Idag visas i en `SidePopPanel` som automatiskt positioneras bredvid toolbar-panelen. Ska kunna dras fritt.
2. **Skapa ärende-dialogen** - Idag en centrerad modal. Ska kunna dras för att se 3D-modellen bakom.

---

## Befintliga mönster att återanvända

Projektet har etablerade drag-patterns i flera komponenter:

| Komponent | Teknik |
|-----------|--------|
| `UniversalPropertiesDialog` | Position state + mouseDown på header + window listeners för move/up |
| `ViewerTreePanel` | Drag + resize med `GripVertical`-ikon som handle |
| `GunnarButton` | Touch-stöd + position persistence till localStorage |

Alla använder samma grundmönster:
```typescript
const [position, setPosition] = useState({ x: 20, y: 100 });
const [isDragging, setIsDragging] = useState(false);
const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
```

---

## Del 1: Flyttbar IssueListPanel

### Nuvarande implementation

`IssueListPanel` renderas inuti `SidePopPanel` som har fast positionering baserat på parent-toolbarens position. Panelen kan inte flyttas självständigt.

### Lösning

Skapa en ny wrapper-komponent `FloatingIssueListPanel` som:

1. Hanterar egen position-state med drag-logik
2. Wrapper `IssueListPanel` med draggable header (GripHorizontal)
3. Ersätter `SidePopPanel` för issues-case i `VisualizationToolbar`

```text
┌─────────────────────────────────────┐
│ ≡  Ärenden (3)               [X]   │  ← Draggable header
├─────────────────────────────────────┤
│                                     │
│  [IssueListPanel content]           │
│                                     │
└─────────────────────────────────────┘
```

### Teknisk implementation

```typescript
// Ny: src/components/viewer/FloatingIssueListPanel.tsx

const FloatingIssueListPanel: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  buildingFmGuid?: string;
  onSelectIssue?: (issue: BcfIssue) => void;
  onCreateIssue?: () => void;
}> = ({ ... }) => {
  const [position, setPosition] = useState({ x: window.innerWidth - 280, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Drag handlers (same pattern as UniversalPropertiesDialog)
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position]);

  // Window listeners for move/up
  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 260, e.clientX - dragOffset.x)),
        y: Math.max(0, Math.min(window.innerHeight - 200, e.clientY - dragOffset.y)),
      });
    };
    const handleUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging, dragOffset]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed z-[61] w-64 border rounded-lg shadow-lg bg-card/80 backdrop-blur-md"
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="flex items-center justify-between p-2 border-b cursor-grab"
        onMouseDown={handleDragStart}
      >
        <GripHorizontal className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Ärenden</span>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <IssueListPanel
        buildingFmGuid={buildingFmGuid}
        onSelectIssue={onSelectIssue}
        onCreateIssue={onCreateIssue}
        className="border-none shadow-none"
      />
    </div>
  );
};
```

---

## Del 2: Flyttbar CreateIssueDialog

### Nuvarande implementation

Använder Radix UI `<Dialog>` med `<DialogContent>` som centreras automatiskt via CSS (`fixed inset-0 flex items-center justify-center`).

### Lösning

Konvertera till en **custom floating panel** istället för modal, liknande `UniversalPropertiesDialog`:

1. Byt ut `<Dialog>` mot en vanlig `<div>` med `fixed` positioning
2. Behåll samma visuella design (DialogHeader, DialogFooter styling)
3. Lägg till draggable header med `GripHorizontal`
4. Behåll backdrop för att blockera klick bakom (valfritt - kan tas bort för full 3D-interaktion)

```text
┌─────────────────────────────────────────┐
│ ≡  Skapa ärende                  [X]   │  ← Draggable header
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ [Skärmdump av vyn]              │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Byggnad: Karolinska Sjukhuset          │
│  📦 1 objekt valt                       │
│                                         │
│  ... (formulärfält) ...                 │
│                                         │
│           [Avbryt]    [Skicka ärende]   │
└─────────────────────────────────────────┘
```

### Teknisk implementation

```typescript
// Uppdatera: src/components/viewer/CreateIssueDialog.tsx

const CreateIssueDialog: React.FC<CreateIssueDialogProps> = ({ ... }) => {
  // Position state
  const [position, setPosition] = useState({ 
    x: Math.max(20, (window.innerWidth - 480) / 2), 
    y: Math.max(20, (window.innerHeight - 600) / 2) 
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Reset position when dialog opens
  useEffect(() => {
    if (open) {
      setPosition({
        x: Math.max(20, (window.innerWidth - 480) / 2),
        y: Math.max(20, (window.innerHeight - 600) / 2),
      });
    }
  }, [open]);

  // Drag handlers (same pattern)
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, textarea')) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 500, e.clientX - dragOffset.x)),
        y: Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.y)),
      });
    };
    const handleUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging, dragOffset]);

  if (!open) return null;

  return (
    <>
      {/* Optional semi-transparent backdrop */}
      <div 
        className="fixed inset-0 z-[70] bg-black/20" 
        onClick={handleClose}
      />
      
      {/* Draggable panel */}
      <div
        className="fixed z-[71] w-[480px] max-w-[calc(100vw-40px)] border rounded-lg shadow-xl bg-card"
        style={{ left: position.x, top: position.y }}
      >
        {/* Draggable header */}
        <div
          className={cn(
            "flex items-center gap-2 px-4 py-3 border-b",
            "cursor-grab select-none",
            isDragging && "cursor-grabbing"
          )}
          onMouseDown={handleDragStart}
        >
          <GripHorizontal className="h-4 w-4 text-muted-foreground" />
          <MessageSquarePlus className="h-5 w-5 text-primary" />
          <span className="font-semibold flex-1">Skapa ärende</span>
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Form content (existing) */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* ... existing form fields ... */}
        </form>

        {/* Footer buttons */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t">
          <Button variant="outline" onClick={handleClose}>Avbryt</Button>
          <Button type="submit" form="issue-form">Skicka ärende</Button>
        </div>
      </div>
    </>
  );
};
```

---

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/components/viewer/FloatingIssueListPanel.tsx` | **NY** - Flyttbar wrapper för ärendelistan |
| `src/components/viewer/CreateIssueDialog.tsx` | Konvertera från Dialog till flyttbar panel |
| `src/components/viewer/VisualizationToolbar.tsx` | Byt ut SidePopPanel för issues mot FloatingIssueListPanel |

---

## Beteende

### Desktop
- Båda panelerna kan dras fritt genom att hålla i headern
- Position begränsas inom viewport
- Cursor ändras till `grab`/`grabbing` under drag

### Mobil
- Eventuellt: Behåll centrerad modal/sheet för CreateIssueDialog
- Touch-stöd kan läggas till med `onTouchStart`/`onTouchMove`

---

## Testning

1. **Drag ärendelistan**: Öppna "Visa ärenden" → Dra panelen → Verifiera att den stannar inom skärmen
2. **Drag skapa-dialogen**: Klicka "Skapa ärende" → Dra dialogen → Verifiera att man kan se 3D-modellen bakom
3. **Form-interaktion**: Verifiera att klick på input-fält INTE startar drag
4. **Stäng dialog**: Verifiera att X-knappen och backdrop-klick fortfarande stänger dialogen
5. **Mobil**: Testa på liten skärm att dialogerna är användbara
