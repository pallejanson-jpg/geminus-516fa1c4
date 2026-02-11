

# Presentation: Bakgrundsbild pa alla slides + Riktiga skarmklipp

## Oversikt

Tva andringar i presentationen:

1. **Bakgrundsbild (chicago-skyline-hero.jpg) pa ALLA slides** -- inte bara titelsliden
2. **Ersatt mockup-bilder med riktiga skarmklipp fran Geminus-appen**

## Detalj 1: Bakgrundsbild pa alla slides

Varje slide-komponent (ProblemSlide, SolutionSlide, ViewerSlide, etc.) har idag en egen `bg-gradient-to-br from-slate-900 to-...` bakgrund. Dessa ersatts med:

- Bakgrundsbild: `chicago-skyline-hero.jpg` (samma som titelsliden)
- Dark overlay ovanpa for lasbarhet (justerat per slide for att behalla fargtemat)
- Gradient-overlayen behalles men laggs ovanpa bilden

```text
Varje slide far denna struktur:
  <div className="relative w-full h-full overflow-hidden">
    <img src={heroImage} className="absolute inset-0 w-full h-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-br from-[farg]/85 to-[farg]/70" />
    <div className="relative z-10 ..."> [befintligt innehall] </div>
  </div>
```

Fargschema per slide:
- **Problem**: `from-slate-900/85 to-slate-800/70`
- **Solution**: `from-slate-900/85 to-cyan-950/70`
- **Viewer**: `from-slate-900/85 to-indigo-950/70`
- **AI Detection**: `from-slate-900/85 to-emerald-950/70`
- **AI Assistants**: `from-slate-900/85 to-purple-950/70`
- **Mobile**: `from-slate-900/85 to-orange-950/70`
- **Tech**: `from-slate-900/85 to-slate-800/70`

## Detalj 2: Riktiga skarmklipp fran Geminus

De nuvarande bilderna i `src/assets/` ar mockups. Jag tar skarmklipp fran den faktiska Geminus-appen och sparar dem som nya filer:

| Slide | Nuvarande mockup | Nytt skarmklipp |
|-------|------------------|-----------------|
| ViewerSlide | `screenshot-viewer.png` | Skarmklipp fran 3D Viewer-vyn |
| AiDetectionSlide | `screenshot-ai-scan.png` | Skarmklipp fran AI Scan-sidan |
| AiAssistantsSlide | `screenshot-gunnar.png` | Skarmklipp fran Gunnar-chatten |
| MobileSlide | `screenshot-mobile.png` | Skarmklipp fran mobilvy (390px) |

Skarmklippen tas fran preview-miljon med riktigt UI och ersatter de befintliga filerna.

## Fil som andras

**`src/pages/Presentation.tsx`** -- Alla 7 slide-komponenter (exkl. TitleSlide som redan har bakgrundsbilden) wrappas med bakgrundsbild + overlay-struktur.

Skarmklipp-filerna overskrives pa plats (samma filnamn, nytt innehall).

