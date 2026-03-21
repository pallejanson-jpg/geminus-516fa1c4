

## Plan: Update Presentation Content + Generate PPTX Export

### Part 1 — Content updates in `src/pages/Presentation.tsx`

**A. Add Tribia / INTERAXO to ecosystem**

- **HubSlide**: Add 6th node "Tribia / INTERAXO" with a teal/sky color (e.g. `border-sky-400/70 bg-sky-500/20`). Position it top-right in the hub diagram. Add SVG connector line from center. Update bottom text from "five" to "six".
- **UnlocksSlide**: Add a 6th row: `{ company: "Tribia", badge: "Doc", value: "INTERAXO project documentation flows into Geminus — construction data becomes an operational asset" }`
- **CompetitionSlide**: Add "Tribia / INTERAXO" to the "Full Addnode data stack" line in the advantage panel.
- **Speaker notes**: Update slides 3, 4, 7 to mention Tribia/INTERAXO.

**B. Reframe Symetri/ACC as "handover"**

- **UnlocksSlide** row for Symetri: Change value to "ACC and Symetri solutions flow into the operational phase — a seamless handover from project to Geminus"
- **Speaker notes** slide 4: Update accordingly.

**C. Change "team/we" to "I"**

- Scan all NOTES and slide text for "we" or "team" implying a group. Key changes:
  - NOTES slide 5: "What we are asking for" → "What I am asking for"
  - NOTES slide 7: "That is our moat" → "That is the moat"
  - Slide 3 bottom: Update note about "Geminus is the missing center" (already fine, no "we")
  - Competition advantage sub-text: "built and owned by Addnode" (fine)

### Part 2 — PPTX Export (script-generated artifact)

Generate `/mnt/documents/geminus-presentation.pptx` using `pptxgenjs`:

- **11 slides** matching the React presentation content
- **Dark theme**: dark navy/charcoal backgrounds (`0A0E1A`), white/cyan text
- **Each slide**: title, subtitle, key content (bullet points, stats, table for competition matrix)
- **Speaker notes** included on each slide via `slide.addNotes()`
- **Images**: The 4 screenshot PNGs and hero image will be embedded as base64
- **Font**: Arial (universally supported)
- **Slide dimensions**: 16:9 widescreen (default pptxgenjs)

The PPTX won't be pixel-identical to the React version but will carry all content, structure, speaker notes, and a consistent dark theme that can be edited in PowerPoint.

### Files

| File | Change |
|---|---|
| `src/pages/Presentation.tsx` | Add Tribia/INTERAXO, reframe Symetri handover, solo "I" language |
| `/mnt/documents/geminus-presentation.pptx` | Generated PPTX export via pptxgenjs script |

