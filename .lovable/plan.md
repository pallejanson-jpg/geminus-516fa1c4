
# Addnode Innovation Pitch — Full Implementation

## What We're Building

A complete rewrite of `src/pages/Presentation.tsx` into a 10-slide Dragon's Den pitch for the **Addnode Innovation** competition. Three new features are added on top of the new slide content:

1. **9 new slides** — Addnode-specific pitch replacing all 8 current generic slides
2. **ROI Slide** — A dedicated slide with concrete financial numbers
3. **Speaker Notes Panel** — Toggle with `N` key, shows talking points per slide

---

## New Slide Order (10 slides, ~4.5 minutes)

| # | Slide | Time | Color |
|---|-------|------|-------|
| 1 | Title — "I'm Pål. I connected the dots." | 25s | Cyan |
| 2 | The AECO Gap — O is missing | 40s | Red/Orange |
| 3 | The Addnode Ecosystem — already there, not connected | 35s | Blue |
| 4 | Geminus — The Bridge | 40s | Cyan |
| 5 | AI That Works Today — screenshot grid | 35s | Emerald |
| 6 | ROI — The Numbers (NEW) | 35s | Green |
| 7 | Built With Vibe-Coding — Pål's story | 30s | Purple |
| 8 | Why Addnode Wins — 3 strategic wins | 35s | Amber |
| 9 | The Ask — $100,000 | 20s | White/Black |

---

## Speaker Notes — Per Slide Talking Points

Each slide gets 4–5 bullet points (~30s of talking). The notes panel is toggled with `N` and appears as a semi-transparent bottom drawer over the slide (does not interrupt the scaled slide area). It includes a timer.

Notes are defined as a `speakerNotes: string[]` array in a `NOTES` constant, indexed by slide number.

### Notes Content

**Slide 1 — Title**
- My name is Pål Janson — Product Solution Manager
- 20 years across both AEC and O within Symetri
- I'm not a developer — I'm a problem-solver who used AI to build a solution
- 3 months ago I had an idea. Today it's running in production.
- This is Geminus.

**Slide 2 — AECO Gap**
- The AECO industry covers Architecture, Engineering, Construction and Operations
- Addnode is strong in A, E and C — through Symetri and its brands
- But O — Operations and Facility Management — is where buildings live for 50 to 100 years
- Symetri and Service Works Global now share the Design Management business area
- This is the moment to close the gap and serve the full lifecycle

**Slide 3 — Ecosystem**
- Addnode already owns the ingredients: SWG, Symetri/ACC, Bimify, Senslinc
- Bimify digitizes existing buildings with AI — turning photos into BIM models
- Senslinc provides real-time IoT data — temperature, CO2, occupancy
- None of these talk to each other today
- Geminus connects them — using APIs that already exist

**Slide 4 — The Bridge**
- Geminus sits in the middle of the Addnode ecosystem
- It pulls BIM from Bimify and ACC, operations data from SWG, sensor data from Senslinc
- No migration needed — we build on top of existing systems
- One interface for the facility manager who doesn't care which system the data comes from
- This is the connective tissue Addnode needs

**Slide 5 — AI That Works Today**
- This is not a prototype or a mockup — it is running in production
- AI scans 360-degree panorama images and registers fire safety assets automatically
- Gunnar answers questions about assets in natural language
- Mobile camera lets field workers photograph an object — Gemini Vision identifies it instantly
- All assets land directly in Asset+ — the SWG system our customers already use

**Slide 6 — ROI**
- A typical facility manager spends 30% of their time finding information
- With Geminus, that drops to under 5% — a saving of roughly 200 hours per person per year
- At a conservative billing rate, that is 60,000 SEK saved per FM employee per year
- SWG has over 500 enterprise customers — even 10% adoption creates enormous value
- Bimify scan-to-BIM combined with Geminus means no manual digitization cost

**Slide 7 — Vibe-Coding**
- I built this without writing a single line of code manually
- I described what I wanted in plain English — the AI wrote the code
- 50+ React components, 15+ serverless backend functions, 6 external API integrations
- 3 months of evenings and weekends
- This competition is about AI plus vibe-coding — and this IS the proof of what that looks like

**Slide 8 — Why Addnode Wins**
- Every Geminus user is locked deeper into the Addnode ecosystem
- Bimify upsell: does your building have a BIM model yet? Now it can.
- Senslinc upsell: do you have real-time sensor data? Add it to your digital twin.
- SWG and Symetri can go to market together for the first time with a joint value proposition
- The O in AECO is a blue ocean — and Addnode already has all the assets to win it

**Slide 9 — The Ask**
- One hundred thousand dollars to productize what is already working
- Security hardening, GDPR compliance, deep SWG Concept Evolution API integration
- Bimify and Senslinc live connectors with certified support agreements
- Six months. A product. A competitive moat across the Design Management business area.
- The code is running. The integrations exist. I'm ready. Are you?

---

## ROI Slide Design — Slide 6

Three columns with concrete numbers:

**Column 1 — FM Efficiency**
- FM spends 30% of time searching for info → drops to <5% with Geminus
- **200 hours saved** per FM employee per year
- 60,000 SEK / €5,400 per person annually

**Column 2 — AI Inventory at Scale**
- Manual asset inventory: 4–6 hours per floor
- AI scan with Geminus: 15–30 minutes per floor
- **10x faster** — at a fraction of the cost

**Column 3 — Ecosystem Value**
- SWG: 500+ enterprise customers
- If 10% adopt Geminus → **50 customers**
- Cross-sell: Bimify + Senslinc per customer = significant upsell ARR

Bottom line: *"The $100,000 investment has the potential to unlock millions in ecosystem value."*

---

## Speaker Notes Panel — Technical Design

A `useState<boolean>` called `showNotes` toggled by the `N` key.

The panel renders **outside** the scaled slide div — positioned as `absolute bottom-0` in the outer container so it's always readable size regardless of slide scale. It has:
- Semi-transparent dark background (`bg-black/80 backdrop-blur`)
- Slide title + 5 bullet points for the current slide
- A simple elapsed timer (`mm:ss`) counting up from 0 when presentation starts
- Close button (or press N again)

```
┌──────────────────────────────────────────────────┐  ← always at bottom of viewport
│  SPEAKER NOTES — Slide 2: The AECO Gap   ⏱ 0:42  │
│  • The AECO industry covers A, E, C and O...      │
│  • Addnode is strong in A, E, C through Symetri   │
│  • O = Operations — buildings live 50–100 years   │
│  • SWG + Symetri now share Design Management      │
│  • This is the moment to close the gap            │
└──────────────────────────────────────────────────┘
```

---

## Files to Modify

### `src/pages/Presentation.tsx` — Full rewrite

**New imports added** (all from existing packages):
- `Network`, `Link2`, `TrendingUp`, `DollarSign`, `Code2`, `Users`, `Clock`, `BookOpen`, `BarChart3`, `CheckCircle2`, `Sparkles`, `Target` from `lucide-react`
- `useRef` for timer (already imported)

**New state added to `Presentation()` shell**:
```tsx
const [showNotes, setShowNotes] = useState(false);
const [elapsed, setElapsed] = useState(0);
const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

Timer starts on first navigation or N press, counts up.

**Keyboard handler updated** to add `N` key toggle for notes.

**Notes panel** rendered after the scaled slide div, inside the outer `fixed inset-0` container.

**Slide registry** updated to 9 entries.

No other files need modification — the HTML standalone version is a separate file and the existing structure there is less critical than the React version.

---

## Summary of Changes to `src/pages/Presentation.tsx`

| Section | Change |
|---------|--------|
| Imports | Add ~12 new lucide icons + `useRef` already there |
| Slide components | Replace all 8 with 9 new Dragon's Den slides |
| NOTES constant | New array of `string[][]` — one entry per slide |
| slides registry | Replace 8 entries with 9 new slide components |
| Presentation() state | Add `showNotes`, `elapsed`, `timerRef` |
| Keyboard handler | Add `N` key to toggle notes |
| JSX | Add speaker notes panel below scaled slide |

The presentation shell (keyboard nav, fullscreen, scale, progress bar, click navigation) stays intact — only content and new features are added.
