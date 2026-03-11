

# Plan: Add "Geminus ESG" Slide as Final Slide

## What

Add a new slide **"Geminus ESG — The Next Revenue Layer"** as the **last slide** (slide 11) in the presentation, after "The Ask". This positions the ESG module as a forward-looking bonus/vision slide.

The module name is **Geminus ESG**.

## Slide Content

**Title**: "Geminus ESG — Sustainability Built In"

**Layout**: Two-column with a bottom summary bar. Dark gradient background (no image), matching the competition deep-dive slide style.

**Left column — "Already in Platform (80%)"**:
- Building data (BIM, areas, floors) — Asset+
- FM & maintenance history — Faciliate
- Energy & indoor climate — Senslinc IoT
- Building hierarchy & rooms — Digital Twin

**Right column — "Geminus ESG Adds (20%)"**:
- ESG Data Model — 80+ sustainability data points
- Carbon/LCA — OneClickLCA integration (sister company)
- EU Taxonomy engine — automated compliance checks
- Report Library — CSRD, Building Logbook, PDF/Excel

**Bottom bar**: Three value statements:
- "CSRD & EU Taxonomy compliance" 
- "50–70% lower reporting cost"
- "New SaaS revenue stream"

**Speaker notes**: Cover the data source breakdown (what comes from where), the customer pain points (fragmented data, manual Excel reporting, audit risk, ESG affecting financing), and the strategic positioning from FM vendor to ESG-native digital twin platform.

## Files Modified

| File | Change |
|------|--------|
| `src/pages/Presentation.tsx` | Add `EsgSlide` component, append to `slides` array, add title to `SLIDE_TITLES`, add notes to `NOTES` |

## Design

- Background: solid dark gradient (`bg-gradient-to-br from-[#0a0e1a] to-[#1a1040]`) — same as competition deep-dive slide
- High-contrast text with `bg-black/50 backdrop-blur-sm` cards
- Icons from lucide-react: `Leaf`, `Zap`, `BarChart3`, `Shield`
- Bottom summary uses cyan/indigo gradient border (matching existing slide patterns)

