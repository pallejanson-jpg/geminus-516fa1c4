

# Plan: Integrate Property Credentials into Create Building Panel

## Problem

The per-building credential configuration currently lives on a separate "Fastigheter" page (`/properties`). The user wants this functionality integrated into the existing **Buildings tab** inside the Settings modal, alongside `CreateBuildingPanel`.

## Solution

Move the property listing and credential override UI into the existing **"building" tab** in `ApiSettingsModal`, so everything building-related lives in one place.

### Changes

| Action | File | What |
|--------|------|------|
| Modify | `src/components/settings/CreateBuildingPanel.tsx` | Add a "Configured Buildings" list at the top showing existing buildings from `building_settings`. Each row has an "Edit" button that opens `CreatePropertyDialog` for credential overrides. |
| Modify | `src/components/settings/ApiSettingsModal.tsx` | No change needed — `CreateBuildingPanel` already renders in the "building" tab |
| Keep | `src/components/properties/CreatePropertyDialog.tsx` | Reuse as-is — it's already a standalone Sheet component |
| Modify | `src/pages/Properties.tsx` | Redirect or simplify to point users to Settings → Buildings |
| Modify | `src/components/layout/AppSidebar.tsx` | Remove or update the "Properties" nav item (or keep it as a redirect) |

### How it works

1. User opens **Settings → Buildings** tab
2. At the top: list of existing buildings (fetched from `building_settings` + `assets`) with name, FM GUID, and badge indicators for custom credentials
3. Click a building → opens `CreatePropertyDialog` sheet for editing identity + API credentials
4. Below the list: existing "Create New Building" form (unchanged)
5. After creating a building, user can immediately click it in the list to configure credentials

### UI Layout in the Buildings Tab

```text
┌─────────────────────────────────────┐
│  Configured Buildings               │
│  ┌─────────────────────────────────┐│
│  │ Building A  │ FM-123  │ [Edit] ││
│  │ Building B  │ FM-456  │ [Edit] ││
│  └─────────────────────────────────┘│
│                                     │
│  ── Create New Building ──          │
│  [existing CreateBuildingPanel UI]  │
└─────────────────────────────────────┘
```

### Files Modified

| File | Change |
|------|--------|
| `src/components/settings/CreateBuildingPanel.tsx` | Add building list with edit buttons, import and open `CreatePropertyDialog` |
| `src/components/layout/AppSidebar.tsx` | Remove "Properties" from sidebar nav |
| `src/pages/Properties.tsx` | Simplify or remove (optional — can keep as redirect) |

