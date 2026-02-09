

# Fix Split View UI: Label, Height, and Toolbar Order

## Changes

### A. Remove "3D Model" label (line 440-443)
Remove the floating label in split mode that says "3D Model".

### B & C. Fix 360 panel: remove header bar that blocks tools
The black bar labeled "360° View" (line 424-426) sits on top of the Ivion iframe/SDK, covering NavVis toolbar icons and creating a height mismatch between the 3D and 360 panels. Remove this label entirely -- just like removing the "3D Model" label. Both panels are self-explanatory.

### D. Reorder mode buttons: 3D - Split - VT - 360
Current order (line 327-330): 360, Split, VT, 3D
New order: 3D, Split, VT, 360

## Files

| File | Change |
|---|---|
| `src/pages/UnifiedViewer.tsx` | (1) Remove "3D Model" label div (lines 439-443). (2) Remove "360° View" label div (lines 424-426). (3) Reorder ModeButton components to 3D, Split, VT, 360. |
