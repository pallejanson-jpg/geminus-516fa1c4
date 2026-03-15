

# Mobile Viewer — Maximera skärmyta (ACC/Dalux-inspirerad redesign)

## Analys av nuläget

Ditt mobila viewer-gränssnitt har idag tre lager som tar skärmyta:

1. **Header** (~40px + safe-area): Bakåt-knapp + lägesväljare (2D/3D/360/Split) + Filter/Viz/Insights-knappar
2. **ViewerToolbar** (botten ~48px + safe-area): Orbit, FP, Fit, Select, Measure, Section, 2D/3D, X-ray, Settings — alltid synlig
3. **FloatingFloorSwitcher** (höger sida, vertikal kolumn): Våningsknappar

Totalt förlorar du ~100-120px vertikal yta på en iPhone — ungefär 15% av skärmen.

## Vad ACC gör (från dina bilder)

ACC:s mobila viewer har:
- **Inget header-fält** — modellnamnet visas minimal, stängknapp (×) längst upp
- **Botten-toolbar** med ~7 små ikoner (hem, redigera, 3D-läge, issues, handverktyg, stäng) — kompakt, ~44px
- **Hamburger-ikon** (☰) som öppnar ett helskärms-sheet med tydliga stora rader: Visningar, Synvinklar, Ärenden, Modellutforskaren, Nivåer
- **Gest-guide** som overlay vid första besöket

Nyckelinsikt: ACC har **en enda toolbar** längst ner, och allt annat öppnas on-demand via en meny-sheet.

## Plan: ACC-inspirerad mobil viewer

### Fas 1: Mockup-sida (`/viewer-mockup`)

Skapa en fristående mockup-sida för att testa och iterera layouten innan vi ändrar den riktiga viewern. Sidan visar en statisk bakgrundsbild (eller den riktiga viewern) med det nya overlay-mönstret.

### Ny layout (konceptuell)

```text
┌─────────────────────────────┐
│ × [Byggnadsnamn] 3D    [☰] │  ← Minimal topbar, transparent, ~32px
│                             │
│                             │
│       3D CANVAS             │  ← Maximerad yta
│       (full edge-to-edge)   │
│                             │
│                             │
│                             │
│ [🏠][✏️][⬡][✓][👆][×]      │  ← Kompakt botten-toolbar, ~44px
└─────────────────────────────┘
```

**Topbar** (transparent gradient, minimal):
- Vänster: × (stäng/tillbaka)
- Center: Byggnadsnamn + aktuellt läge (3D)
- Höger: ☰ hamburger som öppnar **Action Sheet**

**Action Sheet** (fullskärms-drawer nerifrån, ACC-stil):
- Visningsläge (2D / 3D / 2D+3D / 360°) — stora rader med ikoner
- Våningar / Nivåer — stor rad → öppnar floor-picker
- Filter — stor rad
- Visualisering / Inställningar — stor rad
- Insikter — stor rad
- Ärenden — stor rad

**Botten-toolbar** (kompakt, 44px, ACC-stil):
- 6-7 ikoner: Orbit, FP, Fit, Select, Measure, Section, Stäng
- Samma som dagens ViewerToolbar men utan text-labels, bara ikoner
- Settings-kugghjulet integrerat i Action Sheet istället

**Våningsväljare**: Dold by default — öppnas via Action Sheet → "Nivåer" som en horisontell pill-strip eller bottom-sheet.

### Fas 2: Implementering i riktiga viewern

När mockupen ser bra ut appliceras layouten i `MobileViewerPage.tsx` och `NativeViewerShell.tsx` (mobil-branchen).

## Kontextkänslig meny

Du nämnde att landningssidans mobilmeny (FAB) visar appar som FM Access, Senslinc etc — som inte är relevanta inne i viewern. Detta hanteras separat:
- Den befintliga `GeminusPluginMenu` (FAB) ska **inte** visas inne i viewern (det görs redan med `showGeminusMenu={false}` i split-läge)
- Action Sheet i viewern visar **bara viewer-relevanta funktioner**: våningar, filter, visualisering, ärenden, insikter, inställningar

## Filer att skapa/ändra

| Fil | Åtgärd |
|-----|--------|
| `src/pages/ViewerMockup.tsx` | **Ny** — mockup-sida med ACC-inspirerad layout |
| `src/App.tsx` | Lägg till route `/viewer-mockup` |

Mockupen bygger på riktig data (byggnadsnamn, våningslista) men med enklare rendering — fokus på att validera layouten och interaktionsmönstret.

## Resultat

- **Mockup URL**: `/viewer-mockup` — testar den nya layouten utan att bryta befintlig viewer
- **Vinst**: ~60-80px mer canvasyta på mobil (tar bort header + slår ihop toolbars)
- **ACC-mönster**: En toolbar, en hamburger-sheet, maximalt canvas

