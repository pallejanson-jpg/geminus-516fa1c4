

## Custom Right-Click Context Menu for 3D Viewer

### Background
The Asset+ viewer package renders its own right-click context menu using DevExtreme (`dx-context-menu`). It currently shows only built-in Asset+ commands (e.g. "View in space", object details). This menu looks visually different from Geminus AI's design language and cannot be extended with Geminus-specific actions like "Egenskaper" (properties), "Skapa arende" (create issue), or "Skapa arbetsorder" (create work order).

### Approach: Intercept + Replace
Instead of fighting the Asset+ DevExtreme menu, we will:
1. **Suppress the Asset+ context menu** via CSS (`display: none` on `.dx-context-menu`)
2. **Intercept right-click** on the `#AssetPlusViewer` container with our own `onContextMenu` handler
3. **Render a Geminus-styled context menu** using the existing Radix `ContextMenu` or a simple positioned div (matching the dark `bg-card/95 backdrop-blur` style used elsewhere in the app)
4. **Pass custom items via `externalCustomObjectContextMenuItems`** to Asset+ for items that need the viewer's internal context (like the clicked entity), while also adding pure Geminus items

### Context Menu Items
The menu will show these items when right-clicking an object in the 3D viewer:

| Item | Action |
|---|---|
| **Egenskaper** (Properties) | Opens `UniversalPropertiesDialog` for the clicked object's FM GUID |
| **Skapa arende** (Create issue) | Triggers the existing `captureIssueState` flow (screenshot + viewpoint + CreateIssueDialog) |
| **Skapa arbetsorder** (Create work order) | Opens a new work order dialog pre-filled with building/object context, saves to `work_orders` table |
| **Visa i rummet** (View in space) | Calls `assetView.viewInSpace(entityId)` -- the original Asset+ "View in space" action |
| **Valj objekt** (Select) | Calls `assetView.selectItems([entityId])` |
| **Zoom till objekt** (Zoom to fit) | Calls `assetView.viewFit([entityId])` |

### Visual Design
- Dark card background (`bg-card/95 backdrop-blur-md`) with `border-border` and `shadow-xl`
- Rounded corners (`rounded-lg`)
- Each item: icon (16px, colored) + label, with `hover:bg-muted` transition
- Separator lines between groups (Geminus actions / Viewer actions)
- Matches the style already used in `CesiumGlobeView.tsx` context menu (lines 332-370)

### Technical Changes

**File: `src/index.css`**
- Add CSS rule to hide the Asset+ DevExtreme context menu: `#AssetPlusViewer .dx-context-menu-container, .dx-overlay-wrapper .dx-context-menu { display: none !important; }`

**File: `src/components/viewer/ViewerContextMenu.tsx`** (NEW)
- New component that renders a positioned context menu overlay
- Props: `position: {x, y}`, `entityId`, `fmGuid`, `buildingFmGuid`, `onClose`, callbacks for each action
- Renders the menu items with icons (Info, MessageSquarePlus, Wrench, Eye, MousePointer, ZoomIn from lucide)
- Closes on click-outside or Escape key

**File: `src/components/viewer/AssetPlusViewer.tsx`**
- Add `onContextMenu` handler on the viewer container div
- Detect clicked entity using xeokit's `scene.pick()` at the mouse coordinates
- Resolve the entity's FM GUID from the metaScene
- Show `ViewerContextMenu` at the click position with the resolved data
- Add state for context menu visibility, position, and entity data
- Wire up action callbacks: open properties dialog, trigger issue creation, create work order, call viewer API methods

**File: `src/components/viewer/CreateWorkOrderDialog.tsx`** (NEW)
- Simple dialog for creating a work order (similar to `CreateIssueDialog`)
- Fields: title, description, category, priority
- Pre-filled with building name and object info from context
- Saves to the `work_orders` table with `external_id` = `FR-{timestamp}` and source metadata

No database changes needed -- the `work_orders` table already exists with the right schema and RLS policies.
