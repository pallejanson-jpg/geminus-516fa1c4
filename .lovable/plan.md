
# Presentation Rewrite — Value-First for Addnode

## What the Feedback Is Telling Us

The current 9 slides spend too many slides on *what Geminus does technically* (AI Demo, Vibe-Coding stats) and not enough on *why Addnode should invest*. The pitch framework from the uploaded course slides asks: "Why is this important for **us**?" — that question needs to be the emotional backbone of every slide.

Key feedback points:
- Less tech, more business value
- Addnode ecosystem as a hub with Geminus at the center — Symetri, Service Works Global, **In Use**, Bimify
- AECO framing: Geminus = the solution for "O" (Operations/FM), the identified gap in the Design Management business area
- Pål's credibility as the connector between AEC and O
- Keep ROI slide

---

## New Slide Order — 8 slides, ~4 minutes

The two tech-heavy slides (AI Demo + Vibe-Coding) merge into one short "Proof" slide. The Addnode strategic value story gets expanded across two slides.

| # | Slide | Core message | Change from current |
|---|-------|-------------|-------------------|
| 1 | Title — "I'm Pål. I connected the dots." | Who is Pål, what is Geminus | Keep, minor tweak |
| 2 | The AECO Gap | O is missing from Addnode's offering | Keep, minor tweak |
| 3 | The Addnode Hub | Geminus at center, 5 companies orbiting | **Redesign** — add In Use, hub visual |
| 4 | What Geminus Unlocks for Each Company | Per-company value prop | **New slide** replacing Bridge |
| 5 | The Proof — It Already Works | Brief credibility, not a tech deep-dive | **Merge** of old Demo + Vibe-coding |
| 6 | ROI — The Numbers | Concrete financial impact | Keep |
| 7 | Why Addnode Wins | 3 strategic wins for Addnode group | **Rewrite** — Addnode investor language |
| 8 | The Ask | $100K, Dragon's Den close | Keep |

---

## Detailed Slide Redesigns

### Slide 3 — The Addnode Hub (was: Ecosystem)

**The big change**: Redesign from a 4-card grid into a **hub diagram** with Geminus at the center and 5 Addnode companies orbiting it. This visually makes the point that Geminus is the connective tissue, not just another product.

Hub layout:
```
              [Symetri / ACC]
                    |
   [In Use] — [GEMINUS] — [Bimify]
                    |
     [SWG / Asset+] — [Senslinc]
```

Each node shows:
- Company name
- What they bring to Geminus (data type)
- Color coded by company

Bottom statement: *"All five already sit inside Addnode's Design Management business area. Geminus is the missing center."*

### Slide 4 — What Geminus Unlocks for Each Company (NEW)

This is the key business-value slide that was missing. For each Addnode company, show **what they gain** from Geminus — not what Geminus takes from them.

| Company | What Geminus gives them |
|---------|------------------------|
| **Symetri** | Their ACC/BIM data becomes useful in Operations — FM customers stay on Autodesk |
| **Service Works Global** | Asset+ becomes the AI-powered system of record for every building |
| **In Use** | Space utilization data surfaces in real context — digital twin view |
| **Bimify** | Every building Bimify digitizes becomes a Geminus-ready digital twin |
| **Senslinc** | Sensor data becomes actionable — visible in context, triggering FM workflows |

Layout: 5 horizontal rows, each company left, arrow, value right. Compact, scannable, powerful.

### Slide 5 — The Proof (was: Demo + Vibe-Coding merged)

One tight credibility slide. Not a feature tour — just enough to prove this is real:
- Tag: "Running in production"
- 2 screenshot thumbnails (viewer + AI scan) — small, not dominant
- Stats row: 3 months · Non-developer · 50+ components · 6 API integrations
- Quote: *"I described what I wanted. The AI built it."*

This slide answers "is it real?" in 20 seconds without getting into technology.

### Slide 7 — Why Addnode Wins (rewrite)

Current version is good but needs to speak more directly in investor/board language. Rewrite with:

- **Win 1 — A new revenue layer in a €1T market**: FM software is the fastest-growing segment of the built environment. Addnode has zero dedicated product today.
- **Win 2 — Ecosystem lock-in through value**: Every Geminus user deepens their dependency on SWG, Symetri, Bimify, Senslinc simultaneously. Churn across the group drops.
- **Win 3 — A joint go-to-market for Design Management**: For the first time, SWG and Symetri can approach the same customer together — the building owner who needs both construction-phase and operations-phase tools.

Bottom line changes to: *"Geminus turns five separate Addnode companies into one coherent value proposition."*

---

## Speaker Notes — Updated

Notes for slides 3, 4, 5, 7 need to be rewritten to match the new content. Slides 1, 2, 6, 8 keep their existing notes (those slides are mostly unchanged).

**Slide 3 — The Addnode Hub (new notes)**
- Addnode already owns every ingredient needed — the question is who connects them
- Symetri brings BIM and construction data, SWG brings FM operations, Bimify digitizes existing buildings
- In Use brings space utilization data — real occupancy, desk booking, room usage
- Senslinc brings the live heartbeat of the building — IoT sensors in real time
- Geminus is the hub that makes all five more valuable than they are separately

**Slide 4 — What Geminus Unlocks (new notes)**
- This is not about technology — it's about making each Addnode company more competitive
- For Symetri: their customers stop using ACC only for construction — it becomes a lifelong tool
- For SWG: Asset+ becomes the AI-powered system of record — not just a database
- For Bimify: every digitization project creates a lasting digital twin, not just a one-time deliverable
- For Senslinc: sensor data finally has a home — visible, contextual, actionable

**Slide 5 — The Proof (new notes)**
- I want to be clear: this is not a PowerPoint vision — it is running in production today
- A non-developer built this in 3 months using vibe-coding — which is itself the proof of concept for this competition
- The AI scans 360-degree panorama images and registers assets directly into Asset+ automatically
- Six API integrations across the Addnode ecosystem already exist in Geminus right now
- What we are asking for is the investment to turn a working prototype into a certified product

---

## Files to Modify

### `src/pages/Presentation.tsx`

Changes by section:

| Section | Change |
|---------|--------|
| `SLIDE_TITLES` | Update index 2→"The Addnode Hub", index 3→"What Geminus Unlocks", index 4→"The Proof" |
| `NOTES[2]` | New hub-focused notes |
| `NOTES[3]` | New per-company value notes |
| `NOTES[4]` | New proof/credibility notes |
| `NOTES[6]` | Update Why Addnode notes |
| `EcosystemSlide` | Full redesign as hub diagram with 5 companies + In Use |
| `BridgeSlide` | Replace with new `UnlocksSlide` — per-company value table |
| `DemoSlide` | Compress into `ProofSlide` — 2 screenshots + stats, no tech deep-dive |
| `VibeCodingSlide` | Remove — content folded into ProofSlide |
| `WhyAddnodeSlide` | Rewrite copy to investor/board language |
| `slides[]` registry | Remove VibeCodingSlide entry, update order |

**Result: 8 slides instead of 9** — tighter, more focused, less tech.

No new dependencies, no new assets needed. The hub diagram is CSS/JSX, not an image. The two existing screenshots (viewer + AI scan) are still used in the compressed Proof slide.
