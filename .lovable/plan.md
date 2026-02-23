

## Level Labels: Visual Refinements, Floor-Aware Visibility, and Toggle

### Changes Overview

Three improvements to the level labels system:

1. **Smaller, more delicate styling** -- grey background with dark text, zoom-aware scaling
2. **Floor-aware visibility** -- only show labels for currently visible/selected floors
3. **Toggle switch** in VisualizationToolbar alongside room labels

---

### 1. Visual Refinements (useLevelLabels.ts)

Current style: dark card background (`hsl(var(--card) / 0.85)`) with card-foreground text, `font-size: 11px`, `padding: 3px 10px`.

New style:
- Background: light grey semi-transparent (`rgba(180, 180, 180, 0.45)`, `backdrop-filter: blur(4px)`)
- Text: dark/black (`color: rgba(0, 0, 0, 0.75)`)
- Smaller padding: `2px 8px`
- Font size: `10px`
- Border: subtle (`rgba(0, 0, 0, 0.08)`)
- Lighter shadow

**Zoom-aware scaling**: In `updateLabelPositions`, calculate a scale factor based on the ratio of the building's screen-space height to the canvas height. When zoomed out (building small on screen), labels shrink proportionally. Clamp between 0.5 and 1.0 to keep them readable. Apply via `scale()` in the transform.

### 2. Floor-Aware Label Visibility (useLevelLabels.ts)

When floors are filtered/isolated (via filter panel, floor pills, or label click), only the labels for visible floors should appear. Labels for hidden floors should be hidden.

Implementation:
- In the `FLOOR_SELECTION_CHANGED_EVENT` listener: when `isAllFloorsVisible === false`, hide all labels except the one matching the active floor. When `isAllFloorsVisible === true`, show all labels.
- In `isolateFloor`: after setting active state, hide all non-active labels (`display: none`).
- In `restoreAllFloors`: show all labels again.

### 3. Toggle Switch in VisualizationToolbar (VisualizationToolbar.tsx)

Add a simple Switch toggle for "Vaningsetiketter" (Level Labels) placed directly before the existing "Rumsetiketter" section (~line 1031).

- New state: `showLevelLabels`, defaulting to `true`
- On toggle: dispatch `LEVEL_LABELS_TOGGLE_EVENT` with `{ enabled }`
- Import `LEVEL_LABELS_TOGGLE_EVENT` from `useLevelLabels`
- Visual style: same pattern as other toggles (icon + label + Switch)
- Use `Layers` or `Building` icon (Layers is already imported)

---

### Technical Changes

**File: `src/hooks/useLevelLabels.ts`**

| Area | Change |
|---|---|
| Label styling (lines 370-388) | Update `background`, `color`, `padding`, `font-size`, `border`, `box-shadow` to lighter/smaller values |
| Hover style (lines 412-423) | Adjust hover colors to match new lighter scheme |
| `updateLabelPositions` (lines 162-190) | Add scale factor calculation: compute building screen height from AABB projection, derive scale (clamped 0.5-1.0), apply `scale(factor)` in transform |
| `isolateFloor` (lines 233-303) | After setting active label, hide all other labels with `display: none` |
| `restoreAllFloors` (lines 210-230) | Restore `display` to empty string for all labels |
| `FLOOR_SELECTION_CHANGED_EVENT` listener (lines 494-507) | When `isAllFloorsVisible === false`, hide non-matching labels. When true, show all. |

**File: `src/components/viewer/VisualizationToolbar.tsx`**

| Area | Change |
|---|---|
| Imports (~line 1) | Add `LEVEL_LABELS_TOGGLE_EVENT` from `@/hooks/useLevelLabels` |
| State (~line 80) | Add `showLevelLabels` state, default `true` |
| Handler | Add `handleLevelLabelsToggle` that dispatches `LEVEL_LABELS_TOGGLE_EVENT` |
| UI (~line 1031, before "Rumsetiketter") | Add Switch toggle with Layers icon and label "Vaningsetiketter" |

