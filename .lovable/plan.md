
# In-App Presentation for Jury

## Overview
Build a `/presentation` route with a fullscreen slide deck showcasing Geminus. Uses the 1920x1080 scaled-slide pattern, keyboard navigation (arrow keys), and a clean, professional design with the existing hero image and brand colors.

## Slides (7-8 slides)

1. **Title Slide** -- "Geminus - Your Digital Twin Platform" with hero background image, tagline
2. **The Problem** -- Buildings generate massive data but it's fragmented across systems
3. **The Solution** -- Geminus as a unified platform: 3D BIM, 360 panoramas, IoT, AI
4. **3D + 360 Viewer** -- Split/Virtual Twin modes, xeokit BIM models, NavVis Ivion integration
5. **AI Asset Detection** -- Automated scanning of 360 panoramas with Gemini, review queue, auto-registration
6. **AI Assistants** -- Gunnar (data), Ilean (documents), voice commands
7. **Mobile & QR** -- Fault reporting via QR code, mobile inventory, responsive design
8. **Tech Stack & Architecture** -- React, Lovable Cloud, Edge Functions, integrations diagram

## Files to Create/Modify

| File | Change |
|---|---|
| `src/pages/Presentation.tsx` | New -- Full presentation component with all slides, keyboard nav, fullscreen support |
| `src/App.tsx` | Add lazy route `/presentation` (public, no auth) |

## Technical Details

**Presentation.tsx:**
- Fixed 1920x1080 slide canvas scaled via `transform: scale()` to fit viewport
- State: `currentSlide` index, arrow key + click navigation
- Each slide is a function returning JSX, stored in an array
- Fullscreen toggle via Fullscreen API
- Progress bar at bottom showing current position
- Uses existing `chicago-skyline-hero.jpg` for backgrounds
- Clean typography with Tailwind, no external dependencies needed
- Slide counter overlay (e.g. "3/8")
- Escape key exits fullscreen, F key toggles it

**App.tsx:**
- Add `const Presentation = lazy(() => import("@/pages/Presentation"));`
- Add public route (no ProtectedRoute wrapper) at `/presentation`

No new dependencies required. All built with existing React + Tailwind.
