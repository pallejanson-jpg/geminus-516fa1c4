

# Plan: Mobile Split View, English UI & Desktop/Mobile Parity

## Context
The user's reference image (Dalux FM) shows a **vertically stacked 2D/3D split** on mobile — floor plan on top, 3D model on bottom, with a drag handle between them. Our current mobile viewer has NO split mode; it only toggles between full-screen 2D or 3D. The desktop split (2D/3D) uses `SplitPlanView` side-by-side but it's basic and not available on mobile at all.

## Changes

### 1. Mobile Vertical Split View (Dalux-style)
**File: `src/pages/UnifiedViewer.tsx` — `MobileUnifiedViewer` component (lines 737-816)**

Replace the current mobile layout with a vertically stacked split:
- **Top half**: Canvas-based 2D plan view (`SplitPlanView`) showing floor plan
- **Draggable divider**: A circular chevron handle (like Dalux's `^` button) to resize the split ratio
- **Bottom half**: 3D `NativeViewerShell` viewer
- Mode switcher in the header lets users toggle between: **Split** (2D+3D stacked), **3D only**, **2D only**, **360°** (if Ivion available)
- Default mobile mode changes to `split2d3d` when a building is opened (matching Dalux behavior)
- Touch-based resize: user drags the handle to adjust split ratio (30%-70% range)

**File: `src/components/viewer/SplitPlanView.tsx`**
- Add touch event support (`onTouchStart`, `onTouchMove`, `onTouchEnd`) for pan and pinch-zoom on mobile
- Remove Swedish text: `'Laddar planvy...'` → `'Loading plan...'`
- Remove Swedish hint: `'Alt+drag = pan · Scroll = zoom'` → `'Pinch = zoom · Drag = pan'` on mobile

### 2. Desktop Split Improvements
**File: `src/pages/UnifiedViewer.tsx` — desktop split2d3d section (lines 607-620)**
- Replace the fixed 40/60% split with a proper `ResizablePanelGroup` using two panels and a draggable handle
- Add a subtle header label on each pane ("2D Plan" / "3D Model")
- Ensure camera sync indicator (dot on 2D plan) updates in real-time

### 3. All UI Text → English
Multiple files need Swedish→English translation:

**`src/pages/UnifiedViewer.tsx`:**
- `'Laddar viewer...'` → `'Loading viewer...'`
- `'Byggnadsdata saknas'` → `'Building data not found'`
- `'Tillbaka'` → `'Back'`
- `'Split 3D/360°'`, `'Split 2D/3D'`, `'360° Panorama'`, `'2D Planvy'` → English equivalents
- `'Synk aktiv'` → `'Sync active'`
- All tooltip text (Kräver Ivion → Requires Ivion, etc.)
- `'Försök ladda SDK igen'` → `'Retry SDK'`
- `'Alignment-kalibrering'` → `'Alignment calibration'`
- `'3D-modellens synlighet'` → `'3D model opacity'`
- `'Byggnadsinsikter och analys'` → `'Building insights'`

**`src/components/viewer/NativeViewerShell.tsx`:**
- `title="Tillbaka"` → `title="Back"`

**`src/components/viewer/SplitPlanView.tsx`:**
- Canvas text to English

**`src/components/viewer/ViewerFilterPanel.tsx`:**
- `'Visa flyttade objekt'` → `'Show moved objects'`
- `'Visa borttagna objekt'` → `'Show deleted objects'`

**`src/components/viewer/VisualizationToolbar.tsx`:**
- `'Visa rum'` → `'Show spaces'`
- `'Visa ärenden'` → `'Show issues'`
- `'Visa'` section header → `'Visibility'`
- `'Laddar teman...'` → `'Loading themes...'` (ViewerThemeSelector)

**`src/components/viewer/FmAccess2DPanel.tsx`:**
- Various Swedish strings → English

**`src/components/viewer/AlignmentPointPicker.tsx`:**
- `'Ingen panoramaposition tillgänglig...'` → English

**`src/hooks/useObjectMoveMode.ts`:**
- All toast messages to English (the undo toasts added recently)

**`src/pages/NativeViewerPage.tsx` & `src/pages/Viewer.tsx`:**
- `'Laddar byggnadsdata...'` → `'Loading building data...'`

### 4. Mobile/Desktop Parity Verification
- Ensure `MobileViewerOverlay` mode switcher includes `split2d3d` option (add `LayoutPanelLeft` icon)
- Ensure filter panel, floor switcher, and settings all work in split mode on mobile
- The `SplitPlanView` must respect `safe-area-inset` on mobile

## Technical Approach

The mobile split uses CSS `flex-col` with a percentage-based division controlled by state. The drag handle uses `onTouchMove` to update the split ratio. Both panels share the same xeokit viewer instance — the 2D plan reads from `window.__nativeXeokitViewer` (already supported by `SplitPlanView`).

```text
┌─────────────────────┐
│  ← Back   [2D|3D|Split]  ⚙ │  ← header
├─────────────────────┤
│                     │
│   2D Floor Plan     │  ← SplitPlanView (canvas)
│   (touch pan/zoom)  │
│                     │
├────────⌃────────────┤  ← draggable handle
│                     │
│   3D BIM Model      │  ← NativeViewerShell
│   (touch rotate)    │
│                     │
└─────────────────────┘
```

## Files to modify
| File | Change |
|------|--------|
| `src/pages/UnifiedViewer.tsx` | Mobile split layout, English text, desktop split improvement |
| `src/components/viewer/SplitPlanView.tsx` | Touch support, English text |
| `src/components/viewer/mobile/MobileViewerOverlay.tsx` | Add split mode option |
| `src/components/viewer/NativeViewerShell.tsx` | English text |
| `src/components/viewer/ViewerFilterPanel.tsx` | English text |
| `src/components/viewer/VisualizationToolbar.tsx` | English text |
| `src/components/viewer/FmAccess2DPanel.tsx` | English text |
| `src/components/viewer/AlignmentPointPicker.tsx` | English text |
| `src/hooks/useObjectMoveMode.ts` | English toast messages |
| `src/pages/NativeViewerPage.tsx` | English text |
| `src/pages/Viewer.tsx` | English text |

