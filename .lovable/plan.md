

# Fix Floating Floor Switcher Height

## Problem
The floor switcher shows max 5 pills on desktop but the container background stretches beyond the content, creating a tall black/dark area. The user wants up to 10 visible pills on desktop, and the container must fit tightly around the actual pills with zero excess space.

## Changes

### File: `src/components/viewer/FloatingFloorSwitcher.tsx`

1. **Increase max visible pills** (line 32):
   - Change `MAX_VISIBLE_PILLS_DESKTOP` from `5` to `10`

2. **Tighten container spacing** (line 517):
   - Change `gap-px p-1` to `gap-0.5 p-0.5` for minimal padding
   - Ensure `h-auto` remains so container shrinks to content
   - Add `w-auto` to prevent any width-based stretching

3. **Remove any extra elements causing height** -- verify no hidden spacers or margin exist (the drag handle was already removed, confirm no remnant spacing)

## Result
- Up to 10 floor pills visible on desktop (overflow menu only for 11+ floors)
- Container background fits exactly around the pills with no excess dark area
- Mobile stays at 4 max pills

