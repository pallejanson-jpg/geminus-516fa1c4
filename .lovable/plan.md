

## Plan: Complete Remaining English Standardization + QA Fixes

### What's left

~25 files still contain Swedish UI strings, lazy-loading is missing from fallback images, and the UI consistency pass (button/icon/card standardization) has not been applied.

---

### 1. Remaining Swedish → English (25 files)

| File | Key strings to translate |
|---|---|
| `portfolio/RoomsView.tsx` | "Sök rum...", "Inga rum hittades" |
| `portfolio/AssetsView.tsx` | "Inga assets hittades" |
| `portfolio/FacilityLandingPage.tsx` | "Sparade vyer", "+N fler" |
| `pages/GeminusView.tsx` | "Sparade vyer", "Inga resultat hittades" |
| `pages/ApiDocs.tsx` | "Hämta access token", "Hämta versionID (krävs för alla anrop)", all endpoint descriptions |
| `viewer/InventoryPanel.tsx` | "Sök assets…", "Visar 500 av...", "Inga matchande assets" |
| `viewer/BuildingSelector.tsx` | "Är du säker på att du vill ta bort denna sparade vy?" |
| `settings/AppMenuSettings.tsx` | "Spara" |
| `settings/ApiSettingsModal.tsx` | "Inga rum/våningar hittades", "URL sparad", "Inga mappar eller filer hittades" + all remaining Swedish |
| `fm-access/FmAccessObjectPanel.tsx` | "Välj ett objekt...", "Inga egenskaper", "Spara" |
| `fm-access/FmAccessNativeView.tsx` | "Inga byggnader hittades" |
| `globe/CesiumGlobeView.tsx` | "Ingen BIM-källa hittades" |
| `properties/CreatePropertyDialog.tsx` | "FM GUID krävs", "Fastighet sparad" |
| `support/SupportCaseDetail.tsx` | "Beskrivning", "Inga kommentarer ännu" |
| `support/FeedbackThreadDetail.tsx` | "Laddar…", "Inga kommentarer ännu" |
| `insights/RoomSensorDetailSheet.tsx` | "Laddar…" |
| `common/UniversalPropertiesDialog.tsx` | "Inga BIP-matchningar hittades" |
| `hooks/useWebSpeechRecognition.ts` | "Inget tal detekterat. Försök igen." + all error messages |
| `import/ExcelImportDialog.tsx` | "Våning", "Rum", "Beskrivning" column fallback keys (keep as data aliases) |

*Plus a grep sweep for any other remaining Swedish across all .tsx/.ts files.*

### 2. Lazy-loading on fallback images

Add `loading="lazy"` to `<img>` elements that use Unsplash or placeholder URLs in:
- `HomeLanding.tsx` / `HomeLandingV2.tsx` (building cards)
- `FacilityLandingPage.tsx` (hero images)
- `FacilityCard.tsx` (card thumbnails)

### 3. UI Consistency Pass

Apply across high-visibility components:
- **Icon sizes**: Audit toolbar icons → `size={18}` primary, `size={16}` compact
- **Button heights**: `h-9` mobile, `h-10` desktop for toolbar buttons
- **Card radii**: `rounded-xl` for content cards in Portfolio, Home, Settings

Focus on components visible in the demo flow: Home → Portfolio → Building → Viewer.

---

### Estimated scope
- ~25 files modified
- No new files, no database changes
- Low risk — string replacements + attribute additions

