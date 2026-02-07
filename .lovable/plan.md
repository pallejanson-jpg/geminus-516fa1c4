

# Consolidate Ivion URL to `swg.iv.navvis.com`

## Problem

The Ivion base URL is inconsistent across the codebase:
- `src/lib/constants.ts` sets the default `radar.url` to `https://ivion.se` (incorrect)
- Several components hardcode `https://swg.iv.navvis.com` as fallback
- This means CORS probes and SDK loading may target the wrong server

## Changes

### 1. Update default in `src/lib/constants.ts`

Change the `radar` entry from:
```
url: 'https://ivion.se'
```
to:
```
url: 'https://swg.iv.navvis.com'
```

### 2. Create a shared constant for the Ivion base URL

Add a new constant in `src/lib/constants.ts`:
```
export const IVION_DEFAULT_BASE_URL = 'https://swg.iv.navvis.com';
```

### 3. Replace all hardcoded Ivion URLs

Update the following files to use the shared constant or `appConfigs.radar.url`:

| File | Current hardcoded URL | Change |
|------|----------------------|--------|
| `src/lib/constants.ts` | `https://ivion.se` in `radar.url` | Change to `https://swg.iv.navvis.com` |
| `src/pages/SplitViewer.tsx` | `const IVION_FALLBACK_URL = 'https://swg.iv.navvis.com'` | Import and use `IVION_DEFAULT_BASE_URL` |
| `src/pages/IvionInventory.tsx` | `const baseUrl = 'https://swg.iv.navvis.com'` | Import and use `IVION_DEFAULT_BASE_URL` |
| `src/pages/Mobile360Viewer.tsx` | `'https://swg.iv.navvis.com'` fallback | Import and use `IVION_DEFAULT_BASE_URL` |
| `src/components/portfolio/PortfolioView.tsx` | `'https://swg.iv.navvis.com'` fallback | Import and use `IVION_DEFAULT_BASE_URL` |
| `src/components/inventory/InventoryForm.tsx` | `'https://swg.iv.navvis.com'` fallback | Import and use `IVION_DEFAULT_BASE_URL` |
| `src/components/inventory/mobile/PositionPickerStep.tsx` | `'https://swg.iv.navvis.com'` hardcoded | Import and use `IVION_DEFAULT_BASE_URL` |

### 4. Update placeholder text

In `src/pages/SplitViewer.tsx`, the input placeholder references `swg.iv.navvis.com` -- this is already correct and stays as-is.

## Impact

- All Ivion SDK probes and iframe URLs will consistently target `swg.iv.navvis.com`
- CORS configuration only needs to be set up on one server
- Changing the URL in the future only requires updating one constant
- No database changes or backend changes needed

## Files Changed

| File | Change |
|------|--------|
| `src/lib/constants.ts` | Add `IVION_DEFAULT_BASE_URL` constant, update `radar.url` default |
| `src/pages/SplitViewer.tsx` | Import and use `IVION_DEFAULT_BASE_URL` |
| `src/pages/IvionInventory.tsx` | Import and use `IVION_DEFAULT_BASE_URL` |
| `src/pages/Mobile360Viewer.tsx` | Import and use `IVION_DEFAULT_BASE_URL` |
| `src/components/portfolio/PortfolioView.tsx` | Import and use `IVION_DEFAULT_BASE_URL` |
| `src/components/inventory/InventoryForm.tsx` | Import and use `IVION_DEFAULT_BASE_URL` |
| `src/components/inventory/mobile/PositionPickerStep.tsx` | Import and use `IVION_DEFAULT_BASE_URL` |

