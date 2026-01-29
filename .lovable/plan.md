
# Implementation Plan: Mobile-First Inventory Wizard with GPS Detection

## Overview

Transform the mobile inventory experience from a complex form-based approach to a streamlined wizard with GPS-based building detection. The desktop layout remains unchanged.

---

## Phase 1: GPS Hook - `useNearbyBuilding.ts`

Create a custom hook that:
1. Requests user geolocation via browser API
2. Fetches buildings with coordinates from `building_settings` 
3. Joins with `assets` table to get building names
4. Calculates distance using Haversine formula
5. Returns nearest building if within threshold (200m)

```text
Hook Output:
┌──────────────────────────────────────────────┐
│ nearbyBuilding: {                            │
│   fmGuid: '755950d9-...',                    │
│   commonName: 'Centralstationen',            │
│   distance: 45  // meters                    │
│ } | null                                     │
│                                              │
│ isLoading: boolean                           │
│ error: string | null                         │
│ userPosition: { lat, lng } | null            │
│ requestLocation: () => void                  │
└──────────────────────────────────────────────┘
```

**File:** `src/hooks/useNearbyBuilding.ts`

---

## Phase 2: Wizard Framework - `MobileInventoryWizard.tsx`

Main component managing wizard steps and state:

```text
State Management:
┌─────────────────────────────────────────────┐
│ currentStep: 0 | 1 | 2 | 3                  │
│                                             │
│ formData: {                                 │
│   buildingFmGuid: string                    │
│   levelFmGuid: string                       │
│   roomFmGuid: string                        │
│   category: string                          │
│   name: string                              │
│   symbolId: string                          │
│   imageUrl: string | null                   │
│   description: string                       │
│ }                                           │
│                                             │
│ savedPosition: { building, level, room }    │
│ (for quick-loop registration)               │
└─────────────────────────────────────────────┘
```

**File:** `src/components/inventory/mobile/MobileInventoryWizard.tsx`

---

## Phase 3: Step Components

### Step 0: Location Detection
- Shows loading spinner while GPS runs
- If building found within 200m: "Are you at [Building]?" with Yes/No buttons  
- If no building nearby or GPS fails: Skip to manual selection

**File:** `src/components/inventory/mobile/LocationDetectionStep.tsx`

### Step 1: Location Selection
- Building dropdown (pre-filled if GPS confirmed)
- Floor selection with large touch-friendly buttons
- Room selection (optional)
- "Save as quick position" toggle for repeat registrations

**File:** `src/components/inventory/mobile/LocationSelectionStep.tsx`

### Step 2: Category Selection
- Grid of 80x80px touch-friendly category buttons
- Uses existing `INVENTORY_CATEGORIES` from InventoryForm
- Visual feedback on selection

**File:** `src/components/inventory/mobile/CategorySelectionStep.tsx`

### Step 3: Quick Registration
- Large "Take Photo" button with native camera integration (`capture="environment"`)
- Name/designation input
- Auto-selected symbol based on category
- "Save & Register Next" primary action (keeps position + category)
- Optional: Description field, 3D position marker

**File:** `src/components/inventory/mobile/QuickRegistrationStep.tsx`

---

## Phase 4: Update Inventory.tsx

Replace mobile Sheet-based form with new wizard:

```typescript
// Current mobile code (lines 222-277) replaced with:
if (isMobile) {
  return <MobileInventoryWizard onItemSaved={loadRecentItems} />;
}
```

---

## File Structure

```text
src/
├── hooks/
│   └── useNearbyBuilding.ts          (NEW)
│
├── components/inventory/
│   ├── mobile/                        (NEW FOLDER)
│   │   ├── MobileInventoryWizard.tsx
│   │   ├── LocationDetectionStep.tsx
│   │   ├── LocationSelectionStep.tsx
│   │   ├── CategorySelectionStep.tsx
│   │   └── QuickRegistrationStep.tsx
│   │
│   ├── InventoryForm.tsx             (unchanged - desktop)
│   ├── InventoryList.tsx             (unchanged)
│   └── selectors/                    (reused)
│
├── pages/
│   └── Inventory.tsx                 (MODIFIED)
```

---

## Data Flow

```text
1. User opens Inventory on mobile
   │
   ▼
2. MobileInventoryWizard mounts
   │
   ├── useNearbyBuilding() starts GPS detection
   │   ├── navigator.geolocation.getCurrentPosition()
   │   ├── Fetch building_settings WHERE lat IS NOT NULL
   │   ├── Join with assets WHERE category = 'Building'
   │   └── Calculate Haversine distance to each
   │
   ▼
3. LocationDetectionStep renders
   │
   ├── If building within 200m:
   │   └── "Are you at Centralstationen?" → [Yes] [No]
   │
   ├── If no building nearby:
   │   └── Auto-advance to LocationSelectionStep
   │
   └── If GPS fails/denied:
       └── Show message, auto-advance to manual selection
   │
   ▼
4. LocationSelectionStep
   │
   ├── Building dropdown (pre-filled if GPS confirmed)
   ├── Floor buttons (from navigatorTreeData)
   └── Room selector (optional)
   │
   ▼
5. CategorySelectionStep
   │
   └── 4x3 grid of category buttons
   │
   ▼
6. QuickRegistrationStep
   │
   ├── [📷 TAKE PHOTO] → opens native camera
   ├── Name input with suggestion
   ├── Symbol auto-selected from category
   │
   └── [SAVE & REGISTER NEXT]
       ├── Insert to Supabase (same as current InventoryForm)
       ├── Keep position + category
       └── Clear name + photo → ready for next item
```

---

## Database Queries Used

**GPS Detection:**
```sql
-- Get buildings with coordinates
SELECT 
  bs.fm_guid, bs.latitude, bs.longitude,
  a.common_name
FROM building_settings bs
JOIN assets a ON a.fm_guid = bs.fm_guid AND a.category = 'Building'
WHERE bs.latitude IS NOT NULL
```

**Save Asset (existing logic reused):**
```sql
INSERT INTO assets (
  fm_guid, name, common_name, category, asset_type,
  symbol_id, building_fm_guid, level_fm_guid, in_room_fm_guid,
  is_local, created_in_model, attributes
) VALUES (...)
```

---

## UI Specifications

| Element | Size | Notes |
|---------|------|-------|
| Category buttons | 80x80px min | Touch-friendly grid |
| Take Photo button | Full width, 120px height | Native camera access |
| Save button | Full width, 56px height | Primary action |
| Step indicators | Small dots at top | Progress feedback |
| Back button | 44x44px | Each step except first |

---

## Implementation Order

1. **`useNearbyBuilding.ts`** - GPS hook with Haversine formula
2. **`MobileInventoryWizard.tsx`** - Main wizard shell with step state
3. **`LocationDetectionStep.tsx`** - GPS detection UI
4. **`LocationSelectionStep.tsx`** - Building/floor/room selection
5. **`CategorySelectionStep.tsx`** - Category grid
6. **`QuickRegistrationStep.tsx`** - Photo + save logic
7. **`Inventory.tsx`** - Switch to wizard on mobile

---

## Technical Details

### Haversine Formula
```typescript
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}
```

### GPS Options
```typescript
navigator.geolocation.getCurrentPosition(
  success, error,
  { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
);
```

### Camera Input
```tsx
<input type="file" accept="image/*" capture="environment" />
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| GPS permission denied | Show message, skip to manual selection |
| GPS timeout | Show message, skip to manual selection |
| No buildings with coordinates | Skip GPS step entirely |
| No building within 200m | Skip confirmation, show manual selection |
| Photo upload fails | Show toast error, allow retry |
| Save fails | Show toast error, keep form data |
