

## Plan: Create Presentation 2 — Internal Showcase for Addnode Innovations

### Context
A new presentation for an internal audience (colleagues working with Lovable and Geminus in the Addnode Innovations competition). Format: 35 min total, but your part covers:
- **5 min** — Your vibe-coding journey (why it's revolutionary, time comparison)
- **15 min** — Demo support slides (cool features)
- **5 min** — Do's and don'ts / best tips

The 2 min Addnode intro and 10 min Q&A don't need slides from you.

### New file: `src/pages/Presentation2.tsx`

Reuse the same presentation shell (1920x1080 scaled, keyboard nav, speaker notes, fullscreen, timer) from `Presentation.tsx`, but with entirely new slide content.

**Slide deck (~12 slides):**

| # | Title | Content | Time |
|---|-------|---------|------|
| 1 | **Title** | "Geminus — From Idea to Production in 3 Months" / Pål Janson, SWG | — |
| 2 | **The Problem I Saw** | The AECO gap, fragmented data across Addnode companies — brief version of the pitch deck's gap slide | 1 min |
| 3 | **Why Lovable** | What is vibe-coding, why I chose Lovable, comparison: "3 months solo vs ~12-18 months with a dev team" | 2 min |
| 4 | **My Journey — Timeline** | Visual timeline: Week 1-2 first prototype → Week 4 first API integration → Week 8 AI scan → Week 12 production. Key milestones. | 2 min |
| 5 | **The Stack** | Architecture overview: React + Vite + Tailwind + Supabase Edge Functions + xeokit 3D + Ivion 360° + Asset+ API + Senslinc IoT | — |
| 6 | **Feature: Digital Twin** | Screenshot placeholder + description: 3D viewer, floor switching, room visualization, split 3D/360° view | Demo |
| 7 | **Feature: AI Assistants** | Gunnar (operations AI) + Ilean (contextual AI), RAG search, voice commands | Demo |
| 8 | **Feature: AI Asset Scan** | 360° panorama → AI detection → automatic Asset+ registration | Demo |
| 9 | **Feature: Integrations** | Hub diagram showing 6 Addnode companies + external APIs (Mapbox, Cesium, etc.) | Demo |
| 10 | **Feature: IoT & Insights** | Heatmaps, sensor dashboards, predictive maintenance, alarms | Demo |
| 11 | **Do's and Don'ts** | Two-column layout: Do's (start small, iterate, use speaker notes, test on real data) vs Don'ts (don't over-architect, don't fight the AI, don't skip mobile) | 5 min |
| 12 | **Key Takeaways + Q&A** | 3-4 bold statements + "Questions?" | — |

### Route: `/presentation2`

Add lazy import + public route in `App.tsx` (same pattern as `/presentation`).

### Design
Same dark theme as Presentation 1 (dark navy/charcoal with cyan accents), reuse the same hero image and screenshot assets. Same presentation shell with keyboard navigation, speaker notes, timer, and fullscreen support.

### Files

| File | Change |
|---|---|
| `src/pages/Presentation2.tsx` | New file — full presentation with ~12 slides |
| `src/App.tsx` | Add lazy import + `/presentation2` route |

