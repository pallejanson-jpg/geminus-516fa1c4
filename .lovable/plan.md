

# Plan: Fix Asset Sync Message, Column Discovery & Landing Page Background

## Issues

1. **"Syncing assets" message when assets already exist**: The `syncBuildingAssetsIfNeeded` in `asset-plus-service.ts` (line 435) still has the `isAccSourcedBuilding` bail-out that was removed from `AssetsView`. This causes the function to return `{synced: false, count: 0}` for ACC-prefixed buildings, making `AssetsView` think there are no assets and show the sync spinner. Additionally, `ensureBuildingAssets` (line 481) has the same check. The loading message also incorrectly says "Fetching assets for this building from Asset+" — it should just say "Loading assets...".

2. **Missing attribute columns in asset detail list**: The column discovery logic (line 346) filters out any attribute that is NOT an object with `{name, value}` shape. Many attributes from Asset+ sync are stored as plain strings/numbers/booleans (not wrapped in `{name, value}`). These are silently skipped, so users only see the few system columns.

3. **Skyline background on landing page**: Currently uses `ParticleBackground` (animated floating characters). User wants the skyline picture back.

## Files to Modify

### 1. `src/services/asset-plus-service.ts`
- **Remove `isAccSourcedBuilding` check** from `syncBuildingAssetsIfNeeded` (line 435-438) and `ensureBuildingAssets` (line 481-484). All buildings should check the database first and only sync if no assets exist — regardless of source.

### 2. `src/components/portfolio/AssetsView.tsx`
- **Fix loading message** (lines 753-756): Change from "Syncing assets... Fetching assets for this building from Asset+" to "Loading assets..." — generic, source-agnostic.
- **Fix column discovery** (lines 343-356): Also discover plain-value attributes (strings, numbers) that are NOT `{name, value}` objects. Add a branch for non-object attribute values to create columns from them too. Skip known internal keys like `tenantId`, `checkedOut`, etc.

### 3. `src/components/home/HomeLanding.tsx`
- **Replace `ParticleBackground`** with a skyline background image. Use an `img` or CSS background with a city skyline image (e.g. from Unsplash or a local asset). Apply a dark overlay for text readability, keeping the same layout structure.

## Technical Details

**Column discovery fix:**
```typescript
Object.entries(attrs).forEach(([key, value]: [string, any]) => {
  if (discoveredColumns.has(key)) return;
  if (SKIP_KEYS.includes(key)) return;
  
  if (value && typeof value === 'object' && 'name' in value && 'value' in value) {
    // Wrapped property: {name, value}
    discoveredColumns.set(key, { key, label: value.name || key, category: 'userDefined' });
  } else if (value !== null && value !== undefined && typeof value !== 'object') {
    // Plain scalar attribute
    discoveredColumns.set(key, { key, label: extractPropertyName(key), category: 'userDefined' });
  }
});
```

**extractPropertyValue also needs updating** to handle plain scalar values (it currently only unwraps `{value}` objects).

**Skyline background**: Use a high-quality skyline image URL with `object-cover` positioning, overlaid with `bg-background/70` for readability — same overlay pattern as the current `ParticleBackground`.

