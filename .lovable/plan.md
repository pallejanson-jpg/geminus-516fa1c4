

## Make 3D Tree Panel Clearer and Larger

The tree panel in the 3D viewer (`ViewerTreePanel.tsx`) currently uses very compact sizing that makes it hard to interact with, especially checkboxes and expand arrows. This plan increases element sizes throughout the `TreeNodeComponent`.

### Changes in `src/components/viewer/ViewerTreePanel.tsx`

**1. Row padding and text size (line 183)**
- Change `py-0.5 sm:py-1 px-0.5 sm:px-1` to `py-1 sm:py-1.5 px-1 sm:px-1.5`
- Change `text-xs sm:text-sm` to `text-sm`
- Increase indent multiplier from `level * 10` to `level * 14`

**2. Checkbox size (lines 196-199)**
- Change `h-3.5 w-3.5 sm:h-4 sm:w-4` to `h-4 w-4 sm:h-5 sm:w-5`

**3. Expand/collapse chevron (lines 210-223)**
- Change button padding from `p-0.5` to `p-1`
- Change chevron icon from `h-2.5 w-2.5 sm:h-3 sm:w-3` to `h-3.5 w-3.5 sm:h-4 sm:w-4`
- Increase spacer width from `w-3 sm:w-4` to `w-5 sm:w-6`

**4. Type icon size (line 102-119)**
- Change all `getTypeIcon` icons from `h-3.5 w-3.5` to `h-4 w-4`

**5. Node name text (line 234)**
- Change from `text-[11px] sm:text-sm` to `text-sm`

**6. Badges (lines 241-249)**
- Change type badge from `text-[9px] sm:text-[10px] h-3.5 sm:h-4` to `text-[10px] sm:text-xs h-4 sm:h-5`
- Same for descendant count badge

### Summary of Visual Impact
- Row height increases from ~24px to ~32px
- Checkboxes grow from 14/16px to 16/20px -- much easier to tap/click
- Chevron arrows grow from 10/12px to 14/16px -- clearly visible
- Text becomes consistently `text-sm` (14px) instead of 11px on mobile
- Indentation spacing widens for clearer hierarchy

No other files need to change -- all modifications are within `ViewerTreePanel.tsx`.
