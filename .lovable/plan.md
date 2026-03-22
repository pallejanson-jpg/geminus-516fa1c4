

## Plan: Full English Standardization + QA Fixes for Thursday Demo

### Summary
Comprehensive pass across the entire Geminus application to:
1. Translate all Swedish UI strings to English (50+ files)
2. Fix the search placeholder typo
3. Suppress the Data Consistency Banner for demo
4. Standardize button sizes, icon scales, and card border radii
5. Extract duplicated sidebar sync logic into a shared hook
6. Add lazy-loading to fallback images

This is a large batch of changes. The plan groups files by area for clarity.

---

### 1. Layout & Navigation (5 files)

| File | Changes |
|---|---|
| `src/components/layout/AppHeader.tsx` | Fix "Sök byggnader, rum, rum..." → "Search buildings, rooms, objects..." |
| `src/components/layout/MobileNav.tsx` | "Hem" → "Home", "Karta" → "Map" |
| `src/components/layout/LeftSidebar.tsx` | Extract sidebar sync `useEffect` into shared hook |
| `src/components/layout/MainContent.tsx` | Any remaining Swedish labels |
| `src/components/common/DataConsistencyBanner.tsx` | Translate all strings + add `DEMO_MODE` env/localStorage flag to auto-suppress |

### 2. Support Portal (5 files)

| File | Changes |
|---|---|
| `CustomerPortalView.tsx` | "Ärenden" → "Cases", "Kontakt" → "Contact", "Nytt ärende" → "New Case", "Öppettider" → "Office hours", "Vardagar" → "Weekdays" |
| `CreateSupportCase.tsx` | "Nytt supportärende" → "New Support Case", "Avbryt" → "Cancel", "Skapa ärende" → "Submit Case", all labels + placeholders |
| `SupportCaseList.tsx` | Any remaining Swedish filter labels / empty states |
| `FeedbackCreateForm.tsx` | "Beskriv din idé..." → "Describe your idea...", "Avbryt" → "Cancel" |
| `FeedbackView.tsx` | "Inga förslag ännu..." → "No suggestions yet..." |

### 3. Viewer Components (8 files)

| File | Changes |
|---|---|
| `CreateViewDialog.tsx` | "Skapa sparad vy" → "Create Saved View", "Avbryt" → "Cancel", "Spara vy" → "Save View", "Beskrivning" → "Description" |
| `NavigationPanel.tsx` | "Redigera graf" → "Edit Graph", "Navigera" → "Navigate", all instruction text, "Spara graf" → "Save Graph", "Välj startrum/målrum" → "Select start/target room" |
| `InventoryPanel.tsx` | "Visar 500 av..." → "Showing 500 of...", "Inga matchande assets" → "No matching assets" |
| `FloatingFloorSwitcher.tsx` | "Alla våningar" → "All floors" |
| `PositionPickerDialog.tsx` | "Välj position i 3D-modellen" → "Select position in 3D model", "Klicka" → "Click" |
| `ViewerThemeSettings.tsx` | "Avbryt" → "Cancel", "Spara tema" → "Save Theme", "Ta bort" → "Delete", "Färgmappningar" → "Color Mappings" |
| `FmAccessIssueOverlay.tsx` | Any Swedish strings |
| `CreateIssueDialog.tsx` | Any Swedish strings |

### 4. Settings (3 files)

| File | Changes |
|---|---|
| `GeoreferencingSettings.tsx` | "Koordinater sparade" → "Coordinates saved", "Spara koordinater" → "Save Coordinates" |
| `CreateBuildingPanel.tsx` | Any remaining Swedish toast/label text |
| `ProfileSettings.tsx` | Any Swedish labels |

### 5. Inventory & Asset Registration (6 files)

| File | Changes |
|---|---|
| `InventoryForm.tsx` | All Swedish toasts and validation messages → English |
| `InventoryList.tsx` | "Inga registrerade tillgångar" → "No registered assets" |
| `mobile/QuickRegistrationStep.tsx` | "Välj en symbol" → "Select a symbol", "Tillgång sparad!" → "Asset saved!", "Spara & registrera nästa" → "Save & register next" |
| `mobile/LocationSelectionStep.tsx` | "Ingen data hittades" → "No data found", "Välj byggnad/rum" → "Select building/room" |
| `mobile/Ivion360PositionPicker.tsx` | "Position sparad i 360°" → "Position saved in 360°", "Välj position" → "Select position" |
| `ExcelImportDialog.tsx` | "Välj en ifylld Excel-fil" → "Select a completed Excel file", "Avbryt" → "Cancel" |

### 6. AI Scan (2 files)

| File | Changes |
|---|---|
| `ScanConfigPanel.tsx` | "Välj byggnad" → "Select Building", "Laddar byggnader..." → "Loading buildings...", all instruction text |
| `BrowserScanRunner.tsx` | "Förbereder visare..." → "Preparing viewer...", "Skannar..." → "Scanning...", all status strings |

### 7. Fault Report (3 files)

| File | Changes |
|---|---|
| `FaultReportForm.tsx` | "Beskrivning krävs" → "Description required", placeholder text |
| `MobileFaultReport.tsx` | Same as above |
| `FaultReportSuccess.tsx` | "Spara referensnumret" → "Save the reference number" |
| `ErrorCodeCombobox.tsx` | "Sök eller skriv felkod..." → "Search or enter error code..." |

### 8. Map (2 files)

| File | Changes |
|---|---|
| `NavigationMapPanel.tsx` | "Klicka i kartan..." → "Click on the map...", "Skriv adress" → "Enter address", "Välj byggnad" → "Select building" |
| `BuildingMapPicker.tsx` | "Klicka för att sätta position" → "Click to set position" |

### 9. Navigator (4 files)

| File | Changes |
|---|---|
| `NavigatorView.tsx` | "Laddar data..." → "Loading data...", "Inga resultat" → "No results" |
| `VirtualTree.tsx` | "Inga objekt att visa" → "No items to display" |
| `TreeNode.tsx` | "Lägg till" → "Add" |
| `VirtualTreeRow.tsx` | "Lägg till" → "Add" |

### 10. Insights (3 files)

| File | Changes |
|---|---|
| `SensorsTab.tsx` | "Laddar..." → "Loading...", "Inga rum hittades" → "No rooms found", "klicka på ett rum" → "click a room" |
| `RagSearchTab.tsx` | "Inga resultat hittades" → "No results found" |
| `RoomOptimizationTab.tsx` | "Välj en byggnad" → "Select a building" |

### 11. Shared Hook Extraction (new file + 2 edits)

| File | Changes |
|---|---|
| `src/hooks/useSidebarOrder.ts` (NEW) | Extract the duplicated sidebar order sync logic from LeftSidebar and MobileNav |
| `LeftSidebar.tsx` | Use `useSidebarOrder()` |
| `MobileNav.tsx` | Use `useSidebarOrder()` |

### 12. Data Consistency Banner Demo Mode

Add a `localStorage` key `geminus-demo-mode` that, when set to `true`, auto-suppresses the Data Consistency Banner. This can be toggled from the Settings menu or browser console.

### 13. UI Consistency Pass

- Standardize icon sizes: `size={18}` for header/toolbar icons, `size={16}` for compact contexts
- Standardize button sizes: `h-9` mobile, `h-10` desktop for toolbar-level buttons
- Card border radii: `rounded-xl` for content cards consistently

---

### Estimated Scope
- ~50 files modified
- ~1 new file (`useSidebarOrder.ts`)
- No database changes
- No backend/edge function changes

### Risk Assessment
- All changes are string replacements and minor refactoring — low risk
- The