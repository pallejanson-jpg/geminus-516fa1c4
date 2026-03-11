

# Plan: Animated Video Background on Home Landing

## Summary

Replace the static `chicago-skyline-hero.jpg` background on the home landing page with a looping video background showing a data-sphere animation similar to the reference image (Emergent Labs style — glowing numbers/particles forming a sphere on a dark background).

## Approach

Since we cannot generate video inside Lovable, we have two realistic options:

1. **Use a free stock video** — Find a similar dark, abstract data/particle sphere video from a royalty-free source (e.g. Pexels, Pixabay) and host it in `public/`
2. **Use a CSS/canvas animation** — Create a purely code-driven particle sphere effect using Canvas API or CSS, avoiding the need for a video file entirely

**Recommended: Option 2 (Canvas animation)** — No external video dependency, smaller bundle, and we can customize colors/style to match the Geminus brand (cyan/teal tones like the reference image).

## Changes

### 1. New file: `src/components/home/ParticleBackground.tsx`

A React component that renders a `<canvas>` element with an animated 3D particle sphere:
- ~200-300 floating number/dot particles arranged in a sphere
- Cyan/teal color palette matching the reference
- Slow rotation animation
- Dark background (works with the existing `bg-background/70` overlay)
- Uses `requestAnimationFrame` for smooth 60fps animation
- Responsive — fills container, handles resize
- Lightweight — no dependencies, pure Canvas 2D API

### 2. Edit: `src/components/home/HomeLanding.tsx`

- Replace the static `backgroundImage` div (line 168) with the `<ParticleBackground />` component
- Remove the `chicagoHero` import (line 7) since it's no longer needed
- Keep the existing semi-transparent overlay (`bg-background/70`) for text readability

## Technical Notes

- The canvas animation will be paused when the component unmounts (cleanup in `useEffect`)
- On mobile, reduce particle count for performance
- The `chicago-skyline-hero.jpg` asset can remain in the repo (used elsewhere or as fallback)

