

## Plan: UI/UX Improvements -- 7 Changes

### 1. Replace X with ArrowLeft on FacilityLandingPage

**File:** `src/components/portfolio/FacilityLandingPage.tsx`

- Line 4: Add `ArrowLeft` to the lucide import, remove `X` if unused elsewhere
- Lines 290-301: Replace the `<X>` icon with `<ArrowLeft>` in the close button
- Update the `aria-label` / title to "Tillbaka" instead of close semantics

### 2. Add Breadcrumb Navigation in FacilityLandingPage

**File:** `src/components/portfolio/FacilityLandingPage.tsx`

- Add new prop `breadcrumbs?: Array<{ label: string; onClick: () => void }>` to `FacilityLandingPageProps`
- Render a compact breadcrumb bar below the header (after line ~315), showing the navigation path (e.g., "Portfolio > Byggnad > Våning > Rum")
- Style: `text-xs text-white/70` with `>` separators, clickable items except the last (current)

**File:** `src/components/portfolio/PortfolioView.tsx`

- Build the breadcrumbs array from `facilityHistory` + `selectedFacility`:
  ```typescript
  const breadcrumbs = [
    { label: 'Portfolio', onClick: () => { setFacilityHistory([]); setSelectedFacility(null); } },
    ...facilityHistory.map((f, i) => ({
      label: f.commonName || f.name || f.category,
      onClick: () => { setFacilityHistory(prev => prev.slice(0, i)); setSelectedFacility(facilityHistory[i]); }
    })),
    { label: selectedFacility.commonName || selectedFacility.name || selectedFacility.category, onClick: () => {} }
  ];
  ```
- Pass `breadcrumbs` prop to `FacilityLandingPage`

### 3. Add Loading Skeleton to QuickActions

**File:** `src/components/portfolio/QuickActions.tsx`

- Add new prop `isLoading?: boolean`
- Import `Skeleton` from `@/components/ui/skeleton`
- When `isLoading` is true, render 6-8 skeleton rectangles in the grid instead of real buttons:
  ```tsx
  if (isLoading) {
    return (
      <Card className="mt-4 sm:mt-6">
        <CardHeader><CardTitle>Quick Actions</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 sm:gap-2 md:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }
  ```

**File:** `src/components/portfolio/FacilityLandingPage.tsx`

- Pass `isLoading={isLoadingSettings}` to the `QuickActions` component

### 4. Improve HomeLanding Favorites Touch Targets

**File:** `src/components/home/HomeLanding.tsx`

- Line 233: Change `h-24 sm:h-28` to `h-32 sm:h-36` for the image container
- This gives mobile users a larger tap area and more visible hero image

### 5. Fix MobileNav 360 Context (Simplified -- No Ivion Site ID Check)

**File:** `src/components/layout/MobileNav.tsx`

Per your instruction, the user account controls site access so no Ivion site ID lookup is needed. The fix is simpler:

- Destructure `selectedFacility` and `open360WithContext` from `AppContext`
- In `handleAppClick`, add a special case for `id === 'radar'`:
  ```typescript
  if (id === 'radar') {
    const radarConfig = appConfigs?.radar || {};
    const ivionUrl = radarConfig.url || 'https://swg.iv.navvis.com';
    if (selectedFacility?.fmGuid) {
      open360WithContext({
        buildingFmGuid: selectedFacility.fmGuid,
        buildingName: selectedFacility.commonName || selectedFacility.name || '',
        ivionSiteId: '', // User account controls access
        ivionUrl,
      });
    } else {
      setActiveApp('radar');
    }
    setIsMobileMenuOpen(false);
    return;
  }
  ```

### 6. Bottom-sheet for ViewerRightPanel on Mobile

**No changes needed.** The current code already uses `side={isMobile ? "bottom" : "right"}` with `max-h-[75vh]` and `rounded-t-2xl` on mobile (line 467-470). This is already the correct bottom-sheet pattern.

### 7. Offline-first Favorites (Stale-While-Revalidate)

**File:** `src/hooks/useAllBuildingSettings.ts`

- Add localStorage caching with a stale-while-revalidate pattern:
  - On mount, immediately return cached data from localStorage (instant render)
  - Then fetch fresh data from the database in the background
  - When fresh data arrives, update state AND localStorage
  - This eliminates the loading spinner for returning users

```typescript
const CACHE_KEY = 'all-building-settings-cache';

const fetchAll = useCallback(async () => {
  // 1. Read cache first (instant)
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    try { setSettingsMap(JSON.parse(cached)); } catch {}
  }
  // 2. Fetch fresh (background)
  setIsLoading(!cached);
  const { data } = await supabase.from('building_settings').select('*');
  if (data) {
    const map = /* build map */;
    setSettingsMap(map);
    localStorage.setItem(CACHE_KEY, JSON.stringify(map));
  }
  setIsLoading(false);
}, []);
```

### Summary of Files to Modify

| File | Changes |
|---|---|
| `src/components/portfolio/FacilityLandingPage.tsx` | ArrowLeft icon, breadcrumb rendering, pass `isLoading` to QuickActions |
| `src/components/portfolio/QuickActions.tsx` | Add `isLoading` prop + skeleton state |
| `src/components/portfolio/PortfolioView.tsx` | Build and pass breadcrumbs array |
| `src/components/home/HomeLanding.tsx` | Increase favorite card image height |
| `src/components/layout/MobileNav.tsx` | Add radar/360 context handling |
| `src/hooks/useAllBuildingSettings.ts` | Add stale-while-revalidate caching |

