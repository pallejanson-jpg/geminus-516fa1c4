
# Fix AI Scanning: Button Visibility, Styling, and SDK Initialization

## Problem 1: Start Button Hidden Below Scroll
The "Starta AI-skanning" button sits after three full cards (Building Selection, Template Selection, Info Card) and is not visible without scrolling. On most screens it's completely off-screen.

### Fix: `ScanConfigPanel.tsx`
- Move the start button to a **sticky bottom bar** using `sticky bottom-0 bg-background` so it's always visible regardless of scroll position
- Add a top border and padding for visual separation

## Problem 2: White Background / Poor Dark Mode Styling
The scan config page uses default card backgrounds that appear as plain white in light mode with no visual hierarchy.

### Fix: `AiAssetScan.tsx`
- Add `bg-background` to the root container to ensure theme-aware background
- The cards already use `Card` which should adapt, but the outer page container needs the correct background class

## Problem 3: "Laddar 360-visare" Hangs Forever
Console logs show repeated `TypeError: Cannot read properties of null (reading 'offsetHeight')` from Ivion's internal `LeftPanelComponent`. This means the `<ivion>` element is either:
- Not yet mounted in the DOM when the SDK initializes
- Has zero dimensions (the container has `min-h-[300px]` but may not have actual height in the flex layout)

### Fix: `BrowserScanRunner.tsx`
- Give the viewer container **explicit pixel dimensions** instead of relying on flex-grow (`min-h-[400px]` and `width: 100%`)
- Add a `useEffect` that waits for the container to have non-zero dimensions before setting `enabled=true` on `useIvionSdk`, instead of enabling immediately
- Ensure the `<ivion>` element is `display: block` with `width: 100%; height: 100%` (the SDK requires the element to be visible and sized before init)
- Handle the `sdkStatus === 'failed'` state to show an error message with retry instead of being stuck on "Laddar..."

## Technical Changes

### File: `src/components/ai-scan/ScanConfigPanel.tsx`
- Wrap the start button in a `sticky bottom-0` container with `bg-background border-t pt-3 pb-1`
- Move it from inside the scrollable `space-y-6` div to a sibling position

### File: `src/components/ai-scan/BrowserScanRunner.tsx`
- Change viewer container from `flex-1 min-h-[300px]` to a fixed `min-h-[400px] h-[50vh]` to guarantee dimensions
- Delay SDK initialization: use a ref check to confirm container has non-zero `offsetHeight` before enabling
- Show "Fel: SDK kunde inte laddas" when `sdkStatus === 'failed'` instead of staying on "Laddar..."
- Add background color `bg-muted` to viewer container for better visual appearance

### File: `src/pages/AiAssetScan.tsx`
- Add `bg-background` to root container to fix white background in dark mode

## Files to Modify

| File | Change |
|---|---|
| `src/components/ai-scan/ScanConfigPanel.tsx` | Sticky bottom start button |
| `src/components/ai-scan/BrowserScanRunner.tsx` | Fix SDK container sizing, add dimension check before init, handle failed state |
| `src/pages/AiAssetScan.tsx` | Fix background color for dark mode |
