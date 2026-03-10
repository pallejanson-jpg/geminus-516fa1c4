

## Plan: Competitive Market Analysis — New Slide + Detailed Deep-Dive Page

### Context from Research

| Competitor | Strengths | Weaknesses vs Geminus |
|---|---|---|
| **Vyer** | Strong Nordic customer base (Fastpartner, Revelop, Alecta, Vacse, Svenska Handelsfastigheter). Good 2D/3D visualization. Focus on operations & drawing archives. | No AI layer (no assistants, no AI inventory). No integrated FM system. Pure visualization — no workflow. No multi-system data hub. |
| **Digital Buildings (Zynka/Newsec)** | Backed by Newsec (large advisory). "Power BI for Real Estate" — strong analytics. ~50 employees. Good property portfolio dashboards. | Property/portfolio focus, limited deep FM & IoT. No 3D BIM viewer. No AI assistants. Newsec-centric ecosystem. |
| **Twinfinity (Sweco)** | Spun out as Twinfinity AB (Oct 2022). Cloud-based. Links BIM with operational + climate data. Strong Sweco brand. Major property owners as customers. | Closed Sweco ecosystem. No AI inventory/assistants. Consulting-driven (expensive). Not a product company culture. |
| **Autodesk Tandem** | Free tier available. Huge Autodesk ecosystem (Revit, ACC). Tandem Connect + Tandem Insights modules. Strong international reach. | US-centric. Requires Autodesk stack. No Nordic FM integrations. No AI assistants. Expensive at scale (enterprise pricing). |

**Geminus advantages:** AI Assistants (Gunnar/Ilean), AI Inventory (photo scan → auto-register), full Addnode data stack (SWG + Symetri + Bimify + Senslinc), owned IP, vibe-coded in 3 months.

---

### Deliverables

#### 1. New Presentation Slide — "Deep Dive: Competitive Landscape"

Insert a new slide after the existing Competition slide (becomes slide 8, pushing others down).

**Layout:** Full comparison matrix at 1920×1080:
- Top: title "Competitive Landscape — Deep Dive"
- Center: Feature comparison table with rows for key capabilities and columns for each competitor + Geminus
- Capabilities: 3D BIM Viewer, AI Assistants, AI Inventory, IoT Integration, FM System Integration, Multi-vendor Data Hub, Nordic Market Presence, Pricing Model
- Color-coded: green check for Geminus, red/amber/gray for competitors
- Bottom: key takeaway quote

**File:** `src/pages/Presentation.tsx`
- Add `CompetitionDeepDiveSlide` component
- Add to `slides` array after `CompetitionSlide`
- Add title + speaker notes to `SLIDE_TITLES` and `NOTES` arrays

#### 2. Update Existing Competition Slide

Enrich the competitor descriptions with more specific data from research:
- Vyer: mention specific customers (Fastpartner, Alecta, Revelop)
- Digital Buildings: mention "Power BI for Real Estate" positioning, Newsec acquisition
- Twinfinity: mention Sweco spin-off, cloud BIM + climate data
- Autodesk Tandem: mention free tier, Tandem Connect/Insights modules

---

### Summary of Changes

| File | Change |
|---|---|
| `src/pages/Presentation.tsx` | Enrich existing CompetitionSlide data, add new CompetitionDeepDiveSlide, update slide registry + notes |

