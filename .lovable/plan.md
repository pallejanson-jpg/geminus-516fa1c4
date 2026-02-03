
# Plan: Floating Floor Switcher (Pill-baserade våningsknappar)

## Sammanfattning
Skapa en alltid-synlig komponent med horisontellt ordnade "pill"-knappar som flyter direkt över 3D-canvasen. Denna ersätter inte den nuvarande FloorVisibilitySelector i VisualizationToolbar men ger en snabbare, 1-klicks åtkomst till våningsbyten.

## Nuvarande UX-problem

```text
NUVARANDE FLÖDE (3 klick)
─────────────────────────
  Steg 1                 Steg 2                 Steg 3
┌──────────┐         ┌────────────┐         ┌──────────────┐
│ Klicka   │  ───►   │ Klicka     │  ───►   │ Toggla Switch│
│ på ☰     │         │ "Vånings-  │         │ för önskad   │
│ (meny)   │         │  plan >"   │         │ våning       │
└──────────┘         └────────────┘         └──────────────┘

Problem:
• Menyn döljer våningskontrollerna
• Svårt att snabbt växla mellan våningar
• Användaren förlorar rumsligt sammanhang vid varje menyöppning
```

## Ny Arkitektur

```text
NY ARKITEKTUR (1 klick + visuell feedback)
───────────────────────────────────────────

┌─────────────────────────────────────────────────────────┐
│                                                         │
│                    3D VIEWER CANVAS                     │
│                                                         │
│   ┌────────────────────────────────────────────────┐   │
│   │                                                 │   │
│   │                                                 │   │
│   │                                                 │   │
│   │                                                 │   │
│   └────────────────────────────────────────────────┘   │
│                                                         │
│   ┌─────────────────────────────────────────────┐      │
│   │  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │      │
│   │  │Plan│ │Plan│ │Plan│ │Plan│ │Plan│ │ ⋮  │  │◄─ Pills
│   │  │ 0  │ │ 1  │ │ 2  │ │ 3  │ │ 4  │ │    │  │
│   │  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘  │
│   └─────────────────────────────────────────────┘      │
│                                                         │
│   ┌──────────────── TOOLBAR ────────────────────┐      │
└───┴─────────────────────────────────────────────┴──────┘

Interaktioner:
• Klick på pill → Solo-isolera den våningen
• Ctrl/Cmd + Klick → Multi-select (lägg till/ta bort från selektion)
• Dubbelklick/lång tryckning → Visa alla våningar igen
• Aktiv våning = fylld primärfärg
• Inaktiv våning = genomskinlig med border
```

## Teknisk Implementation

### Ny komponent: FloatingFloorSwitcher.tsx

Placering: `src/components/viewer/FloatingFloorSwitcher.tsx`

Denna komponent:
1. Extraherar våningar från xeokit metaScene (samma logik som FloorVisibilitySelector)
2. Visar horisontella pill-knappar
3. Synkroniserar med befintlig FloorVisibilitySelector via FLOOR_SELECTION_CHANGED_EVENT
4. Stödjer scroll eller "more" overflow-knapp för byggnader med många våningar

```typescript
interface FloatingFloorSwitcherProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid?: string;
  isViewerReady?: boolean;
  className?: string;
}
```

### Pill UI-design

```text
PILL STATES
───────────

Inactive (alla våningar synliga):
┌──────────────┐
│   Plan 1     │  ← bg-muted/50, text-muted-foreground
└──────────────┘     hover: bg-muted

Active Solo (endast denna våning):
┌──────────────┐
│   Plan 2     │  ← bg-primary, text-primary-foreground
└──────────────┘     ring-2 ring-primary/30

Partial (del av multi-select):
┌──────────────┐
│   Plan 3     │  ← bg-primary/30, text-primary
└──────────────┘     border-primary

Disabled (vid laddning):
┌──────────────┐
│   Plan 4     │  ← opacity-50, pointer-events-none
└──────────────┘
```

### Interaktionslogik

```typescript
// Klick-hantering med keyboard modifiers
const handlePillClick = (floorId: string, event: React.MouseEvent) => {
  const isMultiSelect = event.ctrlKey || event.metaKey;
  
  if (isMultiSelect) {
    // Toggle denna våning i befintlig selektion
    toggleFloorVisibility(floorId);
  } else {
    // Solo-mode: visa endast denna våning
    setVisibleFloors([floorId]);
  }
};

// Dubbelklick visar alla
const handlePillDoubleClick = () => {
  setVisibleFloors(allFloorIds);
};
```

### Synkronisering med befintliga kontroller

Komponenten lyssnar på och dispatchar samma events som FloorVisibilitySelector:

```typescript
// Lyssna på externa ändringar
useEffect(() => {
  const handleFloorChange = (e: CustomEvent) => {
    setVisibleFloorIds(new Set(e.detail.visibleFloorIds));
  };
  window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorChange);
  return () => window.removeEventListener(...);
}, []);

// Dispatcha vid lokala ändringar
const applyVisibility = (floorIds: Set<string>) => {
  // ... tillämpa synlighet i viewer ...
  window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
    detail: { visibleFloorIds: Array.from(floorIds) }
  }));
};
```

### Responsiv design

```text
DESKTOP (>= 640px)
──────────────────
• Max 8 synliga pills
• Overflow → "+" knapp som expanderar dropdown
• Position: bottom-left, ovanför toolbar
• Horizontal scroll om för många

MOBILE (< 640px)
────────────────
• Max 4 synliga pills (kompakta)
• Swipe-horisontellt för fler
• Kortare labels ("1", "2" istället för "Plan 1")
• Större touch-targets (min 44x44px)
```

### Overflow-hantering

```text
MED OVERFLOW (> 8 våningar)
───────────────────────────
┌──────────────────────────────────────────────────────┐
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────────┐│
│ │ 0  │ │ 1  │ │ 2  │ │ 3  │ │ 4  │ │ 5  │ │ +3 mer ││
│ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────────┘│
└──────────────────────────────────────────────────────┘
                                              │
                                              ▼ Klick
                                    ┌─────────────────┐
                                    │ ☐ Plan 6        │
                                    │ ☐ Plan 7        │
                                    │ ☑ Plan 8        │
                                    └─────────────────┘
```

## Integration i AssetPlusViewer

Lägg till komponenten direkt i viewer-layouten:

```tsx
// I AssetPlusViewer.tsx, efter state.isInitialized check
{state.isInitialized && initStep === 'ready' && (
  <>
    {/* Floating Floor Switcher - always visible pills */}
    <FloatingFloorSwitcher
      viewerRef={viewerInstanceRef}
      buildingFmGuid={buildingFmGuid}
      isViewerReady={true}
      className="absolute bottom-20 left-4 z-20"
    />
    
    <ViewerToolbar ... />
    ...
  </>
)}
```

## Visuell förhandsvisning

```text
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│                         3D VIEWER                              │
│                                                                │
│                    ┌──────────────┐                            │
│                    │   BYGGNAD    │                            │
│                    │              │                            │
│                    │    Plan 2    │ ◄── Synlig våning          │
│                    │   isolerad   │                            │
│                    └──────────────┘                            │
│                                                                │
│  ┌──────────────────────────────────────┐                      │
│  │ ┌───┐ ┌───┐ ┌─────┐ ┌───┐ ┌───┐    │                       │
│  │ │ 0 │ │ 1 │ │  2  │ │ 3 │ │ 4 │    │ ◄── Pills             │
│  │ └───┘ └───┘ └─────┘ └───┘ └───┘    │     (2 är aktiv)      │
│  │  dim   dim   ACTIVE  dim   dim      │                       │
│  └──────────────────────────────────────┘                      │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐   │
│  │              VIEWER TOOLBAR                             │   │
│  └────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

## Filer som ändras/skapas

| Fil | Åtgärd | Beskrivning |
|-----|--------|-------------|
| `src/components/viewer/FloatingFloorSwitcher.tsx` | **Skapa** | Ny pill-baserad våningsväljare |
| `src/components/viewer/AssetPlusViewer.tsx` | **Ändra** | Lägg till FloatingFloorSwitcher |
| `src/lib/viewer-events.ts` | **Ändra** | Lägg till FLOOR_VISIBILITY_SYNC_EVENT |

## Framtida förbättringar (utanför scope)

1. **Animerad transition** - Smooth fade mellan våningar
2. **Thumbnail preview** - Liten planritning vid hover
3. **Keyboard shortcuts** - Siffertangenter 1-9 för snabbval
4. **"Solo mode" indikator** - Visuell feedback när endast en våning är synlig
5. **Swipe gestures** - Swipe upp/ner för nästa/föregående våning

## Prestandaöverväganden

- Pills renderas med `memo()` för att undvika onödiga re-renders
- Event-synkronisering sker med debounce (150ms) för att undvika flimmer
- Overflow-dropdown laddas lazy (endast vid klick)
- Floor extraction görs en gång vid mount, inte vid varje render

