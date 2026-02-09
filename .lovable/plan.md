

# Fix Floor Selection Persistence, Text Contrast, Room Labels Scoping, and Pinnable Right Panel

## Issues and Fixes

### 1. Floor Selector Resets to All Floors When Panel Opens

**Root cause**: `ViewerRightPanel.tsx` line 443 wraps all content in `{isOpen && (...)}`, which means `FloorVisibilitySelector` unmounts when the panel closes and remounts when it opens. Each remount resets `isInitialized`, `localStorageLoaded`, and `visibleFloorIds` to empty defaults. The component then re-runs its initialization effect, and since `initialFloorFmGuid` is never passed from `ViewerRightPanel`, it falls through to localStorage or defaults to all floors.

**Fix**:
- **`ViewerRightPanel.tsx`**: Remove `{isOpen && (...)}` guard so the content stays mounted even when the panel is closed (the Sheet handles visibility via CSS). This prevents the FloorVisibilitySelector from re-initializing every time the panel opens.
- **`ViewerRightPanel.tsx`**: Forward the `initialFloorFmGuid` prop to `FloorVisibilitySelector` so navigation context flows through.
- Add `initialFloorFmGuid?: string` to the `ViewerRightPanelProps` interface.
- **`AssetPlusViewer.tsx`**: Pass `initialFmGuidToFocus` as `initialFloorFmGuid` to `ViewerRightPanel`.

### 2. Room Labels Only on Selected Building

Room labels already operate on the currently loaded building's metaScene (since the viewer loads one building at a time). However, the labels should be explicitly cleared when the building changes. The `useRoomLabels` hook's `createLabels` function already scopes to the viewer's metaScene, so this works. No code change needed -- will verify by ensuring labels are cleared on building change (which the existing cleanup already handles).

### 3. Text Contrast in Right Panel

**Root cause**: The panel uses `bg-card/95 backdrop-blur-md` which in dark mode is `hsl(0, 0%, 6%)` at 95% opacity. The text uses default `text-foreground` (`hsl(0, 0%, 96%)`), but many labels use `text-sm` or `text-muted-foreground` (`hsl(0, 0%, 65%)`), which is too dim against the semi-transparent dark background.

**Fix**: 
- Change `text-muted-foreground` to `text-foreground/80` for better contrast on section labels and secondary text inside the right panel.
- Change panel background from `bg-card/95` to `bg-card` (fully opaque) so text is always readable.

### 4. Pinnable Right Panel

**Current behavior**: The Sheet closes when clicking outside. `modal={false}` is already set, but clicking elsewhere still triggers `onOpenChange(false)`.

**Fix**:
- Add a "pin" toggle button in the panel header.
- When pinned, the `onOpenChange` callback ignores close requests (the user must explicitly unpin or click the close button).
- Store pinned state in `localStorage` so it persists across sessions.
- When pinned, show a pin icon; when unpinned, show an unpin icon.

## Technical Details

### File: `src/components/viewer/ViewerRightPanel.tsx`

1. Add `initialFloorFmGuid?: string` to `ViewerRightPanelProps`.
2. Add pinned state:
   ```typescript
   const [isPinned, setIsPinned] = useState(() => {
     return localStorage.getItem('viewer-right-panel-pinned') === 'true';
   });
   ```
3. Wrap `onOpenChange` to respect pinned state:
   ```typescript
   const handleOpenChange = (open: boolean) => {
     if (!open && isPinned) return; // Don't close when pinned
     onOpenChange(open);
   };
   ```
4. Add pin button in SheetHeader next to title.
5. Remove the `{isOpen && (...)}` conditional wrapper (line 443) -- render content always so FloorVisibilitySelector stays mounted.
6. Pass `initialFloorFmGuid` to `FloorVisibilitySelector` (line 477).
7. Improve text contrast: change `bg-card/95 backdrop-blur-md` to `bg-card/98 backdrop-blur-md`, and update `text-muted-foreground` spans to `text-foreground/70` for better readability.

### File: `src/components/viewer/AssetPlusViewer.tsx`

1. Pass `initialFmGuidToFocus` as `initialFloorFmGuid` to `ViewerRightPanel`:
   ```typescript
   <ViewerRightPanel
     ...
     initialFloorFmGuid={initialFmGuidToFocus}
   />
   ```

## File Summary

| File | Changes |
|---|---|
| `src/components/viewer/ViewerRightPanel.tsx` | Add pin feature, remove isOpen conditional mount, forward initialFloorFmGuid, improve text contrast |
| `src/components/viewer/AssetPlusViewer.tsx` | Pass initialFmGuidToFocus to ViewerRightPanel |

