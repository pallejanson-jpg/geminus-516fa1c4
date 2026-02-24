

## Plan: Viewer Filter Panel, Home Page, and Context Menu Improvements

This is a large set of changes. I'll break it into distinct work items with effort estimates.

---

### Summary of Issues & Changes

| # | Issue | File(s) | Effort |
|---|---|---|---|
| 1 | Filter panel: white text + larger UI elements | `ViewerFilterPanel.tsx` | Easy |
| 2 | Filter panel: "Show all" button next to paintbrush | `ViewerFilterPanel.tsx` | Easy |
| 3 | Filter panel: add close button (X) | `ViewerFilterPanel.tsx` | Already exists (line 828-830) -- no change needed |
| 4 | Filter panel: remove "Building Storey" and "Space" from Categories | `ViewerFilterPanel.tsx` | Easy |
| 5 | Filter panel: space selection shows room in 3D (not blank) | `ViewerFilterPanel.tsx` | Medium |
| 6 | Filter panel: keep slabs visible by default | `ViewerFilterPanel.tsx` | Easy |
| 7 | Rooms clickable in 2D/3D (IfcSpace pickable) | `ViewerFilterPanel.tsx` | Medium |
| 8 | Right panel (Visning): white text + larger elements | `ViewerRightPanel.tsx` | Easy |
| 9 | Remove old model tree | `ViewerTreePanel.tsx`, refs | Medium |
| 10 | Unify context menus (single Geminus menu) | `ViewerContextMenu.tsx`, `AssetPlusViewer` | Medium |
| 11 | Home page: widen layout, "Recent" + "Views" sections with carousel | `HomeLanding.tsx` | Medium |
| 12 | Building landing: saved views on right side | `FacilityLandingPage.tsx` | Medium |
| 13 | 2D mode not starting on desktop | `UnifiedViewer.tsx` | Easy |
| 14 | 3D for Småviken not working on desktop | Needs debugging | Unknown |

---

### Detailed Changes

#### 1. Filter Panel: White Text + Larger UI (ViewerFilterPanel.tsx)

- Add `text-foreground` to the panel container (line 797-802)
- FilterSection header: change `text-xs` to `text-sm` for title, increase badge size
- FilterRow: change `text-xs` to `text-sm`, increase checkbox from `h-3.5 w-3.5` to `h-4 w-4`
- Increase `py-1` to `py-1.5` for better spacing
- Add explicit `text-foreground` on labels to ensure white text in dark mode

#### 2. Filter Panel: "Show All" Button (ViewerFilterPanel.tsx)

- In the header (line 813-831), add a new button with `Eye` icon labeled "Visa alla" next to the paintbrush/X-ray button
- On click, call `handleResetAll()` which already exists and resets all filters

#### 3. Filter Panel: Close Button

The close button already exists at line 828-830 (`<X>` icon calling `onClose`). No change needed.

#### 4. Remove "Building Storey" and "Space" from Categories (ViewerFilterPanel.tsx)

- Line 250-253 already removes Building, Project, Site. Add:
  ```typescript
  counts.delete('Building Storey');
  counts.delete('Space');
  ```

#### 5. Space Selection Shows Room (Not Blank) (ViewerFilterPanel.tsx)

**Root cause**: When a space is checked, `applyFilterVisibility` at line 596-608 puts IfcSpace into `hideIds` and hides them entirely. The selected space's own geometry is hidden.

**Fix**: When spaces are checked, do NOT hide the checked space's entities. Instead:
- In Step 2b, skip hiding IfcSpace entities that belong to checked spaces
- Keep the space visible with its natural geometry (solid, pickable)
- Make slabs semi-transparent (opacity ~0.3) instead of fully invisible, so the floor is still visible
- This matches the reference image: room is visible as a 3D volume with walls

#### 6. Keep Slabs Visible by Default (ViewerFilterPanel.tsx)

- In `fadeIds` handling (line 632-635), change `entity.opacity = 0` to `entity.opacity = 0.3` so slabs remain visible as semi-transparent floors instead of disappearing

#### 7. Rooms Clickable in 2D/3D (ViewerFilterPanel.tsx)

- Currently IfcSpace is in `obstructTypes` (line 598) which hides them entirely
- Change approach: when filters are active, make IfcSpace visible but semi-transparent (opacity 0.1-0.2) and **pickable**, so users can click on rooms
- When no filters are active (full reset/show all), keep IfcSpace as-is (handled by the viewer's defaults)

#### 8. Right Panel (Visning): White Text + Larger Elements (ViewerRightPanel.tsx)

- Add `text-foreground` to SheetContent and section headers
- Increase label text from `text-xs` to `text-sm` where appropriate
- Ensure all text uses `text-foreground` for dark mode visibility

#### 9. Remove Old Model Tree

- Remove the `ViewerTreePanel.tsx` component references from `UnifiedViewer.tsx` and `MobileViewerOverlay.tsx`
- Keep the file for now but remove all import/render references
- The FilterPanel replaces this functionality

#### 10. Unify Context Menus

- The Asset+ viewer has its own DevExtreme context menu which is hidden via CSS overrides
- The Geminus `ViewerContextMenu` captures right-clicks on the canvas
- Ensure the CSS override fully suppresses Asset+'s menu
- Add any missing Asset+ actions (like "Isolate", "Hide selected") into `ViewerContextMenu` if not already present

#### 11. Home Page: Wider Layout + Recent + Views (HomeLanding.tsx)

- Change `max-w-2xl` to `max-w-4xl` for a wider layout
- Replace "My Favorites" section with two sections:
  - **Recent**: Last 6 buildings worked with (3 per row), with carousel if >3
  - **Views**: Last 6 saved views (3 per row), with carousel if >3
- Track recent buildings in localStorage (record building fmGuid + timestamp on each visit)
- Fetch saved views from `saved_views` table
- Use `embla-carousel-react` (already installed) for the carousel

#### 12. Building Landing: Saved Views on Right Side (FacilityLandingPage.tsx)

- Add a section to the right of the main content showing saved views for this building
- Fetch from `saved_views` table filtered by `building_fm_guid`
- Display as a card grid with screenshot thumbnails

#### 13. 2D Mode Not Starting on Desktop (UnifiedViewer.tsx)

- The existing re-dispatch logic (lines 220-226) only fires when `viewerReady` becomes true
- The issue is likely the same timing problem as mobile: the 2D event fires before ViewerToolbar mounts
- The fix at line 220-226 should work, but may need to also check if the toolbar is actually mounted
- Add a small delay (500ms) to the re-dispatch to ensure toolbar is ready:
  ```typescript
  useEffect(() => {
    if (viewerReady && viewMode === '2d') {
      const timer = setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent(VIEW_MODE_2D_TOGGLED_EVENT, { detail: { enabled: true } })
        );
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [viewerReady, viewMode]);
  ```

#### 14. Småviken 3D Not Working

Need to debug this separately -- likely a data/model loading issue specific to that building's configuration. Will investigate console logs.

---

### Implementation Order

**Batch 1 (Easy, immediate)**:
1. Filter panel text/sizing improvements
2. "Show All" button
3. Remove Building Storey/Space from Categories
4. Slab visibility fix
5. 2D desktop init fix
6. Right panel text fixes

**Batch 2 (Medium)**:
7. Space selection room visibility fix
8. Rooms clickable (IfcSpace pickable)
9. Remove old model tree references
10. Unify context menus

**Batch 3 (Medium-Large)**:
11. Home page redesign (Recent + Views + carousel)
12. Building landing saved views

---

### Technical Details

**Space visibility fix (items 5, 6, 7)** -- the core logic change in `applyFilterVisibility`:

```text
Current flow:
  IfcSpace → hideIds → setObjectsVisible(false)
  IfcSlab  → fadeIds → opacity=0, pickable=false

New flow:
  IfcSpace (checked) → keep in solidIds, visible + pickable + natural color
  IfcSpace (unchecked) → semi-transparent (opacity 0.15), pickable=true
  IfcSlab  → opacity=0.3, pickable=false (visible floor)
```

**Recent buildings tracking**: Store in localStorage as `geminus-recent-buildings` with `{ fmGuid, timestamp, name, image }[]`, max 6 entries, updated whenever user opens a building.

**Saved views on home**: Query `saved_views` table ordered by `created_at DESC LIMIT 6`.

