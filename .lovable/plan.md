

# Plan: English Standardization + XKT Cache Verification

## Part 1: XKT Cache Behavior — Already Working ✓

The XKT caching is **already correctly implemented**:

- `xktMemoryCache` is a **module-level global** `Map<string, ArrayBuffer>` in `useXktPreload.ts` — it survives component unmounts and route changes
- `UnifiedViewer` keeps a single AssetPlusViewer/NativeViewerShell instance and uses CSS display toggling for mode switches (2D↔3D↔split) — no remount, no re-fetch
- When the user exits the viewer to the FacilityLandingPage and returns, the memory cache still holds the XKT data (up to the 200 MB limit)
- `globalPreloadedBuildings` Set prevents duplicate preload attempts
- `clearBuildingFromMemory` is only called explicitly (cache invalidation), never on navigation

**No changes needed here.**

## Part 2: Swedish → English Translation

Comprehensive sweep of all Swedish UI strings across 37+ frontend files. The scope covers every user-facing string — placeholders, toasts, error messages, labels, tooltips, button text, and empty states.

### Files to update (grouped by area):

**Viewer & 3D (recently changed):**
| File | Swedish strings |
|---|---|
| `src/components/viewer/NativeXeokitViewer.tsx` | "Inga 3D-modeller hittades..." (2 occurrences, lines 284, 384) |
| `src/components/viewer/AssetPropertiesDialog.tsx` | "Kunde inte hämta data", "Välj position i 3D-vyn först", "Egenskaper sparade", "Klicka i 3D...", "Ändra", "Välj position", "Välj typ/symbol...", "Avbryt", "Spara", "Redigera" |
| `src/components/viewer/AlignmentPanel.tsx` | "Spara" title |
| `src/components/viewer/FmAccessIssueOverlay.tsx` | "Du måste vara inloggad", "Kunde inte skapa ärende", "Ärende skapat!", "Skapa ärende" |
| `src/components/viewer/CreateIssueDialog.tsx` | Check for Swedish strings |
| `src/components/viewer/CreateWorkOrderDialog.tsx` | Check for Swedish strings |

**Inventory & Registration:**
| File | Swedish strings |
|---|---|
| `src/components/inventory/ImageUpload.tsx` | "Bild uppladdad!", "Kunde inte ladda upp bild", "Ladda upp", "Välj bild" |
| `src/components/inventory/UnplacedAssetsPanel.tsx` | "Sök assets..." |
| `src/components/inventory/IvionRegistrationPanel.tsx` | "Välj kategori/symbol/våningsplan/rum..." |
| `src/components/inventory/selectors/BuildingSelector.tsx` | "Välj byggnad..." |
| `src/components/inventory/mobile/LocationSelectionStep.tsx` | "Välj byggnad/rum..." |
| `src/components/inventory/mobile/PhotoScanStep.tsx` | "AI-krediter saknas...", "Kunde inte analysera bilden..." |
| `src/components/inventory/mobile/QuickRegistrationStep.tsx` | "Uppladdad bild" |

**Search & Common:**
| File | Swedish strings |
|---|---|
| `src/components/common/CommandSearch.tsx` | "Sök byggnader, våningar, rum...", "Inga resultat hittades" |
| `src/components/common/SearchResultsList.tsx` | "Inga resultat hittades" default |
| `src/components/fm-access/FmAccessSearch.tsx` | "Sök objekt i FM Access..." |

**Portfolio & Pages:**
| File | Swedish strings |
|---|---|
| `src/components/portfolio/AssetsView.tsx` | "Sök assets..." |
| `src/pages/PluginPage.tsx` | "Inga byggnader hittades" |
| `src/pages/Mobile360Viewer.tsx` | "Inga byggnader tillgängliga" |
| `src/pages/FmAccessDashboard.tsx` | "Kunde inte hämta ritningar/dokument", "Inga ritningar/dokument hittades" |
| `src/pages/AssetRegistration.tsx` | "Välj typ..." |
| `src/pages/IvionCreate.tsx` | "Välj kategori/symbol/byggnad/våning/rum..." |
| `src/pages/Properties.tsx` | "Uppdatera" title |

**Support & Feedback:**
| File | Swedish strings |
|---|---|
| `src/components/support/FeedbackCreateForm.tsx` | "Kunde inte skicka" |
| `src/components/support/FeedbackThreadDetail.tsx` | "Kunde inte skicka kommentar" |
| `src/components/support/SupportCaseList.tsx` | "Sök ärenden..." |

**Chat & AI:**
| File | Swedish strings |
|---|---|
| `src/components/chat/GunnarChat.tsx` | "Hej! Du arbetar i FM Access...", "Välj en byggnad..." |

**Insights:**
| File | Swedish strings |
|---|---|
| `src/components/insights/tabs/SensorsTab.tsx` | "Uppdatera" title |

### Translation approach

Each Swedish string gets a direct English equivalent. Examples:
- "Inga 3D-modeller hittades..." → "No 3D models found for this building. Sync XKT models via Settings → Buildings, or upload an IFC file."
- "Välj byggnad..." → "Select building..."
- "Kunde inte hämta data" → "Failed to fetch data"
- "Spara" → "Save"
- "Avbryt" → "Cancel"
- "Skapa ärende" → "Create issue"
- "Sök assets..." → "Search assets..."
- "Inga resultat hittades" → "No results found"

### Edge functions (lower priority)

`supabase/functions/gunnar-chat/index.ts` and `supabase/functions/errorreport-proxy/index.ts` also contain Swedish error messages. These should be translated too for consistency, though they are less user-visible.

### Estimated scope

~150-200 individual string replacements across ~30 files. Straightforward find-and-replace with no logic changes.

