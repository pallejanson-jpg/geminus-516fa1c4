

## Analysis: Streaming Service UX for Geminus

### The Metaphor Mapping

```text
Streaming Service          Geminus (Current)         Geminus (Enhanced)
─────────────────          ─────────────────         ──────────────────
Home / "For You"           HomeLanding               ✓ Already close
Browse categories          Portfolio (complex groups) → Genre-style rows
TV Series                  Building                  → "Hero banner" feature
Season                     Floor / Storey            → Season-style navigation
Episode                    Room / Space              → Episode cards with previews
"Continue Watching"        Recent buildings          ✓ Already exists
"My List"                  Favorites                 → Needs a visible row
Trailer / Preview          —                         → Auto-play 360 on hover
Search                     Global search             → Full-screen command palette
```

### What Works Today

The Portfolio already has the carousel-per-complex pattern (like Netflix genre rows). The HomeLanding has "Recent" and "Saved Views" which map to "Continue Watching" and "My List". FacilityCard already uses the image-with-overlay-text pattern that streaming services use.

### What Is Missing (5 Concrete Enhancements)

**1. Hero Spotlight Banner**
Netflix always opens with one large featured item. The Portfolio and Home pages lack this. Add a full-width hero banner at the top of Portfolio showing a random/favorite building with a large backdrop image, title overlay, and two CTA buttons ("Open 3D" / "View Details"). This immediately sets the premium tone.

**2. "My Favorites" Row**
Building favorites exist in `building_settings` but are never shown as a dedicated carousel row. Add a "Favorites" row above the complex groups in Portfolio (and optionally on Home), using the same carousel pattern. This is the equivalent of "My List" on Netflix.

**3. FacilityCard Hover Preview**
On desktop, streaming services show a preview/trailer on hover. When hovering a FacilityCard for 800ms, expand the card slightly (scale + elevation) and show a mini-info overlay: floor count, room count, area, and quick-action buttons (3D, 360, Details). This transforms passive browsing into active discovery.

**4. Building Landing as "Series Page"**
The FacilityLandingPage already shows floors and saved views. Push this further by restructuring it as a "series page": floors displayed as horizontal "season" tabs or pills at the top, and rooms shown as a grid of "episode" cards below the selected floor. Each room card shows its name, area, and a small 2D thumbnail if available. This replaces the current list-heavy approach with visual browsing.

**5. Full-Screen Search (Command Palette)**
Replace the small header search input with a Netflix-style full-screen search overlay (triggered by the same search icon or Ctrl+K). Use the existing `useSearchResults` hook and `SearchResultsList` but render them in a centered modal with a large input, categorized results, and keyboard navigation. The `cmdk` library is already installed.

### Implementation Scope

| Enhancement | Files Affected | Effort |
|---|---|---|
| Hero Spotlight Banner | `PortfolioView.tsx`, `HomeLanding.tsx` | Small |
| Favorites Row | `PortfolioView.tsx`, `useAllBuildingSettings` | Small |
| Card Hover Preview | `FacilityCard.tsx` | Medium |
| Series-style Landing | `FacilityLandingPage.tsx` | Medium |
| Command Palette Search | New `CommandSearch.tsx`, `AppHeader.tsx` | Medium |

### Technical Notes

- The hero banner can reuse `getHeroImage()` from `useAllBuildingSettings` and `getFavorites()` to pick the featured building.
- The hover preview uses CSS `group-hover` with a delayed transition; no new dependencies needed.
- The command palette search leverages the existing `cmdk` package (already installed) and `useSearchResults` hook.
- The "series page" restructure keeps the same data flow from `allData` but changes the visual layout from vertical scroll to tabbed floor selection + room grid.
- All changes are purely frontend; no database or backend changes required.

