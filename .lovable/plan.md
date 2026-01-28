

# Plan: Omstrukturera VisualizationToolbar med kollapsbar "Viewer settings"

## Sammanfattning

Reorganiserar VisualizationToolbar enligt önskad struktur:
1. Flytta "Viewer settings" (kollapsbar sektion) EFTER "Visa"-sektionen och FÖRE "Åtgärder"
2. Ta bort Arkitektvy-switch (finns nu i Viewer-tema)
3. Samla viewer-tema, bakgrundsfärg-palett och belysning/solstudie i den kollapsande sektionen

---

## Ny struktur

```text
VisualizationToolbar
├── BIM-modeller (submeny)
├── Våningsplan (submeny)  
├── Klipphöjd (endast i 2D)
├── Separator
├── "Visa"-sektion
│   ├── 2D/3D (switch)
│   ├── Visa rum (switch)
│   ├── Visa annotationer (switch)
│   └── Rumsvisualisering (switch)
├── Separator
├── "Viewer settings" (kollapsbar sektion)
│   ├── Viewer-tema (dropdown)
│   ├── Bakgrundsfärg (färgpalett)
│   └── Belysning & Solstudie (LightingControlsPanel)
├── Separator
└── "Åtgärder"-sektion
```

---

## Detaljerade ändringar

### Fil: `src/components/viewer/VisualizationToolbar.tsx`

### 1. Nya imports

Lägg till imports för Collapsible-komponenter och Settings-ikon:
```tsx
import { Settings, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
```

### 2. Ny state för kollapsbar sektion

```tsx
const [viewerSettingsOpen, setViewerSettingsOpen] = useState(false); // Stängd som standard
```

### 3. Ta bort Arkitektvy-relaterad kod

Ta bort:
- `isArchitectMode` state (rad 97)
- `handleArchitectModeToggle` callback (rad 206-210)
- Arkitektvy-switch UI (rad 627-647)
- Event listener för `ARCHITECT_MODE_CHANGED_EVENT` (rad 221-229)

Behåll:
- `architectBackground` state (behövs för bakgrundsfärg-paletten)
- `handleBackgroundChange` (behövs för bakgrundsfärg-paletten)
- `ARCHITECT_BACKGROUND_PRESETS` import

### 4. Omstrukturering av innehållet

Nuvarande ordning i "Visa"-sektionen:
```
Visa-sektionen:
├── ViewerThemeSelector
├── Separator
├── Arkitektvy (switch) ← TA BORT
├── Bakgrundsfärg ← FLYTTA till Viewer settings
├── LightingControlsPanel ← FLYTTA till Viewer settings
├── Separator
├── 2D/3D (switch)
├── Visa rum (switch)
├── Visa annotationer (switch)
└── Rumsvisualisering (switch)
```

Ny ordning:
```
Visa-sektionen:
├── 2D/3D (switch)
├── Visa rum (switch)
├── Visa annotationer (switch)
└── Rumsvisualisering (switch)

Separator

Viewer settings (kollapsbar):
├── ViewerThemeSelector
├── Bakgrundsfärg (palett)
└── LightingControlsPanel
```

### 5. UI-struktur för kollapsbar sektion

```tsx
<Separator />

{/* Viewer Settings - Collapsible Section */}
<Collapsible open={viewerSettingsOpen} onOpenChange={setViewerSettingsOpen}>
  <CollapsibleTrigger asChild>
    <button className="flex items-center justify-between w-full py-2 hover:bg-muted/50 rounded-md transition-colors">
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="p-1 sm:p-1.5 rounded-md bg-muted text-muted-foreground">
          <Settings className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </div>
        <span className="text-xs sm:text-sm font-medium">Viewer settings</span>
      </div>
      <ChevronDown className={cn(
        "h-4 w-4 text-muted-foreground transition-transform",
        viewerSettingsOpen && "rotate-180"
      )} />
    </button>
  </CollapsibleTrigger>
  <CollapsibleContent className="space-y-3 pt-2">
    {/* Viewer Theme Selector */}
    <ViewerThemeSelector 
      viewerRef={viewerRef}
      disabled={!isViewerReady}
    />
    
    {/* Background color palette */}
    <div className="py-1.5 sm:py-2">
      <div className="flex items-center gap-2 sm:gap-3 mb-2">
        <div className="p-1 sm:p-1.5 rounded-md bg-muted text-muted-foreground">
          <Palette className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </div>
        <span className="text-xs sm:text-sm">Bakgrundsfärg</span>
      </div>
      <div className="pl-8 sm:pl-10">
        <div className="grid grid-cols-5 gap-1.5">
          {ARCHITECT_BACKGROUND_PRESETS.map((preset) => (
            <button
              key={preset.id}
              title={preset.name}
              onClick={() => handleBackgroundChange(preset.id)}
              className={cn(
                "w-5 h-5 sm:w-6 sm:h-6 rounded-md border-2 transition-all",
                "hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary/50",
                architectBackground === preset.id
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-border/40"
              )}
              style={{
                background: `linear-gradient(180deg, rgb(255, 255, 255) 0%, ${preset.bottom} 100%)`
              }}
            />
          ))}
        </div>
      </div>
    </div>
    
    {/* Lighting Controls */}
    <LightingControlsPanel
      viewerRef={viewerRef}
      isViewerReady={isViewerReady}
    />
  </CollapsibleContent>
</Collapsible>

<Separator />
```

---

## Visuell förhandsvisning

### Stängd Viewer settings:
```
┌─────────────────────────────────┐
│ Visa                            │
│ ┌─────────────────────────────┐ │
│ │ ◻ 2D/3D              [OFF] │ │
│ │ ◻ Visa rum           [OFF] │ │
│ │ ◻ Visa annotationer  [OFF] │ │
│ │ ◻ Rumsvisualisering  [OFF] │ │
│ └─────────────────────────────┘ │
│─────────────────────────────────│
│ ⚙ Viewer settings          ▼   │
│─────────────────────────────────│
│ Åtgärder                        │
│ [📷 Skapa vy                  ] │
│ [➕ Registrera tillgång       ] │
└─────────────────────────────────┘
```

### Öppen Viewer settings:
```
┌─────────────────────────────────┐
│ Visa                            │
│ ...                             │
│─────────────────────────────────│
│ ⚙ Viewer settings          ▲   │
│ ┌─────────────────────────────┐ │
│ │ 🎨 Viewer-tema              │ │
│ │ ┌───────────────────────┐   │ │
│ │ │ Standard (System)  ▼ │   │ │
│ │ └───────────────────────┘   │ │
│ │                             │ │
│ │ 🎨 Bakgrundsfärg            │ │
│ │ ┌───┬───┬───┬───┬───┐      │ │
│ │ │░░░│░░░│░░░│░░░│░░░│      │ │
│ │ ├───┼───┼───┼───┼───┤      │ │
│ │ │░░░│░░░│░░░│░░░│░░░│      │ │
│ │ └───┴───┴───┴───┴───┘      │ │
│ │                             │ │
│ │ ☀ Belysning          [ON]  │ │
│ │   Omgivningsljus ──── 80%  │ │
│ │   Riktat ljus ─────── 60%  │ │
│ │                             │ │
│ │ ☀ Solstudie          [OFF] │ │
│ └─────────────────────────────┘ │
│─────────────────────────────────│
│ Åtgärder                        │
└─────────────────────────────────┘
```

---

## Teknisk sammanfattning

| Ändring | Beskrivning |
|---------|-------------|
| Ny import | `Settings`, `ChevronDown`, `Collapsible`, `CollapsibleContent`, `CollapsibleTrigger` |
| Ny state | `viewerSettingsOpen` (default: false) |
| Ta bort | `isArchitectMode` state, `handleArchitectModeToggle`, Arkitektvy-switch UI, `ARCHITECT_MODE_CHANGED_EVENT` listener |
| Behåll | `architectBackground`, `handleBackgroundChange`, bakgrundsfärg-paletten |
| Flytta | ViewerThemeSelector, Bakgrundsfärg, LightingControlsPanel → in i Viewer settings |
| Struktur | Visa-sektion först → Separator → Viewer settings (kollapsbar) → Separator → Åtgärder |

---

## Fil som ändras

| Fil | Ändring |
|-----|---------|
| `src/components/viewer/VisualizationToolbar.tsx` | Omstrukturering enligt ovan |

