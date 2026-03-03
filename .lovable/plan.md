

# Plan: Geminus Plugin Menu for External Applications

## Problem

Today, when FM Access (or other external apps) loads in an iframe, only a single "Skapa ärende" FAB button is overlaid (via `FmAccessIssueOverlay`). The user wants a comprehensive floating menu that provides access to multiple Geminus features from within any embedded external application.

## What to Build

### 1. New Component: `GeminusPluginMenu`

A floating action menu (FAB with expandable radial/list) that replaces the single-purpose `FmAccessIssueOverlay`. It renders as a small Geminus logo button in the bottom-right corner. Clicking it expands a vertical list of action buttons:

| Action | Icon | Opens |
|--------|------|-------|
| Create Issue | MessageSquarePlus | `CreateIssueDialog` (existing) |
| Create Support Case | LifeBuoy | `CreateSupportCase` dialog (existing) |
| Insights | BarChart2 | `InsightsDrawerPanel` as a modal/sheet |
| Ask Gunnar | Bot icon | `GunnarChat` in a floating panel |
| Ask Ilean | FileText | `IleanButton` chat panel |
| Create Work Order | Wrench | `CreateWorkOrderDialog` (existing) |

The menu accepts `buildingFmGuid`, `buildingName`, and `source` as props so all child dialogs have correct context.

### 2. Changes to Existing Files

**`FmaInternalView.tsx`**: Replace `<FmAccessIssueOverlay>` with `<GeminusPluginMenu>`.

**`FmAccess2DPanel.tsx`**: Same replacement -- swap out the single issue overlay for the full plugin menu.

**`Ivion360View.tsx`**: Add `<GeminusPluginMenu>` alongside the existing registration panel buttons, providing the same Geminus features in the 360 view.

### 3. Component Architecture

```text
GeminusPluginMenu (FAB bottom-right)
  ├── Expanded action list (animated slide-up)
  │     ├── Create Issue → CreateIssueDialog
  │     ├── Support Case → CreateSupportCase (sheet)
  │     ├── Insights → InsightsDrawerPanel (sheet)
  │     ├── Gunnar → GunnarChat (floating panel)
  │     ├── Ilean → IleanButton chat (floating panel)
  │     └── Work Order → CreateWorkOrderDialog
  └── Collapsed state: single branded button
```

The menu itself is a self-contained component with internal state for which sub-dialog is open. Each action triggers the existing dialog/component -- no new backend work needed.

### 4. Implementation Details

- **Styling**: Frosted glass FAB matching existing overlay style (`bg-card/80 backdrop-blur-md`). Actions animate in/out with scale+fade.
- **Mobile**: On mobile, the expanded menu uses a bottom sheet instead of a radial/list to avoid touch conflicts with the iframe.
- **Context passing**: The menu receives `buildingFmGuid` and `buildingName` and passes them to each sub-component. For Gunnar/Ilean, it sets the building context before opening.
- **Reusability**: The same `GeminusPluginMenu` component works in FMA+ iframe, FM Access 2D panel, 360 view, and any future embedded app.

### 5. Files to Create/Modify

| File | Action |
|------|--------|
| `src/components/viewer/GeminusPluginMenu.tsx` | **Create** -- new FAB menu component |
| `src/components/viewer/FmaInternalView.tsx` | **Edit** -- replace `FmAccessIssueOverlay` with `GeminusPluginMenu` |
| `src/components/viewer/FmAccess2DPanel.tsx` | **Edit** -- replace `FmAccessIssueOverlay` with `GeminusPluginMenu` |
| `src/components/viewer/Ivion360View.tsx` | **Edit** -- add `GeminusPluginMenu` |

No database changes or edge function changes needed -- this is purely a UI composition layer reusing existing components.

