
# Felanmalan - Quick Action for Fault Reporting

## Overview

Build a new "Felanmalan" (Fault Report) feature that mirrors the er-rep.com workflow within Geminus. The feature supports two entry points:

1. **QR-kod scanning** (mobile-first): User scans a QR code on-site, which opens a mobile-optimized fault report form pre-filled with building/room context.
2. **Quick Action** (desktop/app): User clicks "Felanmalan" in the QuickActions panel on a facility landing page, opening a desktop-optimized form.

The data is stored in the existing `work_orders` table.

---

## Form Fields

Based on analysis of er-rep.com (Angular/DevExtreme app using QR key-based routing) and the existing `work_orders` schema, the form will contain:

| Field | Type | Required | Maps to `work_orders` column |
|-------|------|----------|------------------------------|
| Rubrik (Title) | Text input | Yes | `title` |
| Beskrivning (Description) | Textarea | Yes | `description` |
| Kategori | Select (El, VVS, Hiss, Bygg, Ventilation, Stad/Rent, Ovrigt) | Yes | `category` |
| Prioritet | Radio pills (Lag/Medel/Hog/Kritisk) | No (default: Medel) | `priority` |
| Foto | Camera/file upload (up to 3 images) | No | `attributes.images[]` |
| Namn (reporter) | Text input | Yes | `reported_by` |
| E-post | Email input | Yes | `attributes.reporter_email` |
| Telefon | Phone input | No | `attributes.reporter_phone` |

Auto-populated fields (from QR or context):
- `building_fm_guid` / `building_name` -- from QR key or facility context
- `space_fm_guid` / `space_name` -- from QR key or facility context
- `status` -- defaults to 'open'
- `external_id` -- generated unique ID (e.g. `FR-{timestamp}`)
- `reported_at` -- current timestamp

---

## Architecture

### Route: `/fault-report` (public, no login required)

A standalone route (like `/ivion-create`) that can be accessed via QR code without logging in. QR codes will resolve to URLs like:

```
https://{app-domain}/fault-report?key={qr-key}
```

The `key` parameter maps to a building or room fm_guid via a lookup (see QR mapping below).

### QR Code Mapping

New database table `qr_report_configs` to map QR keys to buildings/rooms:

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| qr_key | text (unique) | The key from the QR code URL |
| building_fm_guid | text | Building reference |
| building_name | text | Display name |
| space_fm_guid | text (nullable) | Optional room reference |
| space_name | text (nullable) | Room display name |
| is_active | boolean | Whether this QR config is active |
| created_at | timestamp | Creation time |

RLS: Public SELECT (no auth required for reading config), admin-only INSERT/UPDATE/DELETE.

---

## File Structure

### New Files

```
src/pages/FaultReport.tsx                           -- Main page (route handler)
src/components/fault-report/FaultReportForm.tsx      -- Desktop form layout
src/components/fault-report/MobileFaultReport.tsx    -- Mobile wizard layout
src/components/fault-report/FaultReportSuccess.tsx   -- Success/confirmation screen
src/components/fault-report/QrScanner.tsx            -- QR code scanner (camera)
src/components/fault-report/PhotoCapture.tsx         -- Photo upload/camera component
```

### Modified Files

```
src/App.tsx                                         -- Add /fault-report route (public)
src/components/portfolio/QuickActions.tsx            -- Add Felanmalan button
src/components/portfolio/FacilityLandingPage.tsx     -- Wire up onFaultReport handler
src/context/AppContext.tsx                           -- Add fault report context/navigation
src/components/layout/MainContent.tsx                -- Add fault_report case
```

---

## Mobile Layout (Wizard Steps)

Following the same pattern as `MobileInventoryWizard`:

```text
Step 1: QR / Plats (Location)
  +----------------------------------+
  |  [<]  Felanmalan          [Scan] |
  |  (o) (o) (o) (o)  <-- step dots |
  |                                  |
  |  Skanna QR-kod eller valj plats  |
  |                                  |
  |  [Camera viewfinder / QR scan]   |
  |                                  |
  |  -- or --                        |
  |  [Valj byggnad manuellt]         |
  +----------------------------------+

Step 2: Felinformation
  +----------------------------------+
  |  [<]  Felanmalan                 |
  |  (.) (o) (o) (o)                 |
  |                                  |
  |  Byggnad: Smaviken               |
  |  Rum: Korridor Plan 01           |
  |                                  |
  |  Kategori *                      |
  |  [El v]                          |
  |                                  |
  |  Rubrik *                        |
  |  [________________]              |
  |                                  |
  |  Beskrivning *                   |
  |  [________________]              |
  |  [________________]              |
  |                                  |
  |  Prioritet                       |
  |  [Lag] [Medel] [Hog] [Kritisk]   |
  +----------------------------------+

Step 3: Foto
  +----------------------------------+
  |  [<]  Felanmalan                 |
  |  (.) (.) (o) (o)                 |
  |                                  |
  |  Ta foto av felet                |
  |                                  |
  |  [Camera / Upload area]          |
  |  [Photo 1] [Photo 2] [+]        |
  |                                  |
  |  [Hoppa over]        [Nasta ->]  |
  +----------------------------------+

Step 4: Kontaktuppgifter + Skicka
  +----------------------------------+
  |  [<]  Felanmalan                 |
  |  (.) (.) (.) (o)                 |
  |                                  |
  |  Ditt namn *                     |
  |  [________________]              |
  |                                  |
  |  E-post *                        |
  |  [________________]              |
  |                                  |
  |  Telefon                         |
  |  [________________]              |
  |                                  |
  |  [=== Skicka felanmalan ===]     |
  +----------------------------------+
```

---

## Desktop Layout

A single-page form similar to the Inventory desktop layout:
- Left panel (35%): Form with all fields visible in a scrollable card
- Right panel (65%): Map showing building location (if coordinates available) or placeholder

When opened from QuickActions, building/room info is pre-filled.

---

## Technical Details

### 1. Database Migration

```sql
CREATE TABLE public.qr_report_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_key TEXT UNIQUE NOT NULL,
  building_fm_guid TEXT NOT NULL,
  building_name TEXT,
  space_fm_guid TEXT,
  space_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.qr_report_configs ENABLE ROW LEVEL SECURITY;

-- Public can read (needed for QR code lookups without auth)
CREATE POLICY "Anyone can read active qr configs"
  ON public.qr_report_configs FOR SELECT
  USING (is_active = true);

-- Only admins can manage configs
CREATE POLICY "Admins can manage qr configs"
  ON public.qr_report_configs FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Allow anonymous inserts to work_orders (for QR-based reports)
-- Add a new policy for unauthenticated fault reports
CREATE POLICY "Anyone can insert fault reports"
  ON public.work_orders FOR INSERT
  WITH CHECK (status = 'open');
```

### 2. Photo Storage

Use the existing `inventory-images` storage bucket (public). Photos are uploaded to a `fault-reports/{work_order_id}/` path and URLs stored in `attributes.images[]`.

### 3. App.tsx Route

```typescript
const FaultReport = lazy(() => import("@/pages/FaultReport"));

// Public route (no ProtectedRoute wrapper)
<Route
  path="/fault-report"
  element={
    <Suspense fallback={...}>
      <FaultReport />
    </Suspense>
  }
/>
```

### 4. QuickActions Integration

Add a new button "Felanmalan" with `AlertTriangle` icon in `QuickActions.tsx`. It calls a new `onFaultReport` prop that navigates to the fault report form with building context pre-filled.

### 5. AppContext Changes

Add `startFaultReport(prefill)` function similar to `startInventory`:
- Sets `faultReportPrefill` state with building/room context
- Sets `activeApp` to `'fault_report'`

### 6. QR Scanner

Use the device camera via `navigator.mediaDevices.getUserMedia` and a lightweight QR detection library. When a QR is scanned:
1. Parse the URL to extract the key
2. Look up the key in `qr_report_configs` table
3. Pre-fill building/room fields
4. Advance to the form step

For the initial implementation, manual building selection will also be available as fallback.

### 7. Form Validation (Zod)

```typescript
const faultReportSchema = z.object({
  title: z.string().trim().min(1, "Rubrik kravs").max(200),
  description: z.string().trim().min(1, "Beskrivning kravs").max(2000),
  category: z.string().min(1, "Valj en kategori"),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  reporterName: z.string().trim().min(1, "Namn kravs").max(100),
  reporterEmail: z.string().trim().email("Ogiltig e-postadress").max(255),
  reporterPhone: z.string().trim().max(20).optional(),
});
```

---

## Implementation Order

| Priority | Task | Files |
|----------|------|-------|
| 1 | Create `qr_report_configs` table + RLS + work_orders anonymous insert policy | Migration |
| 2 | Create `FaultReportForm.tsx` (desktop form component) | New file |
| 3 | Create `MobileFaultReport.tsx` (mobile wizard) | New file |
| 4 | Create `PhotoCapture.tsx` (camera/upload component) | New file |
| 5 | Create `FaultReportSuccess.tsx` (confirmation screen) | New file |
| 6 | Create `FaultReport.tsx` page (route handler, desktop/mobile switch) | New file |
| 7 | Add `/fault-report` route to `App.tsx` (public) | Modified |
| 8 | Add "Felanmalan" to QuickActions + wire up in FacilityLandingPage | Modified |
| 9 | Add `fault_report` app case to MainContent + AppContext | Modified |
| 10 | Create `QrScanner.tsx` (QR code camera scanning) | New file |
