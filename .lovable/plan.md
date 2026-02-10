

# Presentation Upgrade: English, Screenshots, Transitions & Export

## 1. Translate all slides to English

All Swedish text in the 8 slides will be replaced with English equivalents. Examples:
- "Problemet" -> "The Problem"
- "Losningen" -> "The Solution"
- "Teknik & Arkitektur" -> "Technology & Architecture"
- All descriptions, bullet points, and quotes translated

## 2. Add slide transitions

Add a CSS fade+slide transition between slides:
- Wrap the slide content in a keyed container with Tailwind animation classes
- Use `key={current}` to trigger re-mount on slide change
- Apply `animate-fade-in` (already defined in the project's Tailwind config) for a smooth 300ms fade+translateY entrance on each slide change

## 3. Add screenshots

Take screenshots of key app views using the browser tool and save them as assets. Embed them in relevant slides:
- **Viewer slide**: Screenshot of the 3D/Split viewer
- **AI Detection slide**: Screenshot of the AI scan review queue
- **Mobile slide**: Screenshot of the mobile fault report form
- **AI Assistants slide**: Screenshot of Gunnar chat

These will be captured from the running preview and placed in `src/assets/` as PNG files, then imported into the slide components.

## 4. Generate a downloadable HTML presentation

Since we cannot create native `.pptx` files without a heavy library, we will create a **standalone HTML file** in `public/geminus-presentation.html` that:
- Contains all 8 slides as self-contained HTML/CSS (no React dependency)
- Can be opened in any browser offline
- Can be printed to PDF from the browser
- Includes the same styling, transitions, and keyboard navigation
- Embeds screenshots as base64 data URIs

This gives the user a portable file they can share, present offline, or convert to PDF.

## Files to create/modify

| File | Change |
|---|---|
| `src/pages/Presentation.tsx` | Translate all text to English, add fade transition via keyed wrapper, embed screenshot images |
| `public/geminus-presentation.html` | New standalone HTML slide deck (portable, no dependencies) |
| `src/assets/screenshot-*.png` | Screenshots captured from the app (3-4 images) |

## Technical details

**Transitions in Presentation.tsx:**
```tsx
<div key={current} className="w-full h-full animate-fade-in">
  <SlideComponent />
</div>
```
The `key` prop forces React to unmount/remount, triggering the fade-in animation on each slide change.

**Standalone HTML file:**
- Single file, ~200 lines of HTML/CSS/JS
- Same 1920x1080 scaled canvas approach
- Arrow key navigation, fullscreen support
- All styles inline (no external dependencies)
- Screenshots embedded as base64 or referenced from relative paths

