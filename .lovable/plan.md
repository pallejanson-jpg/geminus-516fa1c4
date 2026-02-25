

## Analysis Results

### Issue 1: Akerselva 2D flips back to 3D

**Root cause confirmed:** `UnifiedViewer.tsx` line 190-211 fires a `LOAD_SAVED_VIEW_EVENT` after 2 seconds. The start view data defaults `viewMode` to `'3d'` (line 198: `viewMode: (sv.viewMode as '2d' | '3d') || '3d'`). When `applyViewSettings` runs in `AssetPlusViewer.tsx` (line 3147), it dispatches `VIEW_MODE_REQUESTED_EVENT` with `mode: '3d'`, overriding the user's manual 2D selection.

The SDK-fail guard (line 157-162) was already fixed to only affect vt/split/360. This is a different code path.

**Fix:** In `UnifiedViewer.tsx`, the start view effect must respect the current `viewMode`. If the user has already switched to 2D, the start view should NOT override it. Guard the `LOAD_SAVED_VIEW_EVENT` dispatch:
- If the user's current `viewMode` differs from the start view's `viewMode`, override the start view's `viewMode` with the user's choice before dispatching.
- Alternatively, skip the `viewMode` field entirely when the user has manually changed mode since page load.

### Issue 2: Småviken "no 3D"

**Logs show the model DOES load** (8.22 MB XKT cached, `allModelsLoadedCallback` fires, camera falls back to `viewFitAll`). The DB has `model_name: "Modell 1"` and `"Modell 2"` — neither starts with "A", so the A-model filter is disabled and both models load.

The DB `model_name` values ("Modell 1", "Modell 2") are generic and don't match the expected naming convention ("A-modell", "ARK-modell", etc.). The Asset+ API returns `name: "ARK-modell"` for `bc185635`, which IS the A-model. The `xkt_models` table uses generic names from when the models were synced.

**Fix:** Update the A-model filter to also check the Asset+ API response (`GetAllRelatedModels`) for model names. The network requests show this API returns `"ARK-modell"` with the correct `bimObjectId`. Use this as a fallback name source when DB names are generic/UUID-like.

Additionally: update the `xkt_models` rows for Småviken to have correct `model_name` values ("A-modell" / "V-modell") via a migration or the sync function.

But since the model IS loading and the 3D IS rendering per the logs, there might be a visual/camera issue. Need the user to confirm what they see.

### Issue 3: Sending an issue kills 3D and removes annotations

**Root cause:** When `SendIssueDialog.handleSend` completes, it calls `onClose()` which closes the dialog. The `IssueDetailSheet` has a realtime subscription on `bcf_issues` (line 2148-2163 in AssetPlusViewer). If the send-issue-email edge function modifies `bcf_issue_assignments` table (not `bcf_issues`), the subscription shouldn't fire. However:

1. The `IssueDetailSheet` allows status changes. If the user changes status, that updates `bcf_issues`, which triggers the realtime handler calling `loadIssueAnnotationsRef.current?.()`. This reloads issue annotations but should be harmless since `loadIssueAnnotations` checks for existing markers (`if (issueAnnotationsManager.annotations[markerId]) return`).

2. The real problem is likely that dialog open/close causes a React re-render cascade that unmounts/remounts `AssetPlusViewer`. The `SendIssueDialog` is rendered inside `IssueDetailSheet` which is inside `ViewerRightPanel`/`VisualizationToolbar`. If any parent component's key or conditional rendering changes, the entire viewer could unmount.

Need to verify: does `showIssueDetail` or `selectedIssue` state change in a way that triggers a re-render of the parent component?

### Issue 4: Issues auto-load despite "default OFF" setting

**Root cause confirmed:** `ViewerRightPanel.tsx` line 125 has `const [showIssues, setShowIssues] = useState(true)`. This should be `false`.

Additionally, even with `showIssues=true`, no event is dispatched at mount — only on toggle. But the `IssueListPanel` (used by `FloatingIssueListPanel`) does its own Supabase queries and subscriptions, which could indirectly trigger loads.

### Issue 5: Email not reaching recipient

The edge function `send-issue-email` uses `getClaims()` which may not exist on all Supabase client versions. Need to verify the auth validation works. Also uses Resend API with `from: "Geminus <onboarding@resend.dev>"` which is the Resend test domain — emails only deliver to the domain owner's email address.

---

## Planned Changes

### A. Fix Akerselva 2D→3D (UnifiedViewer.tsx)

In the start view effect (line 182-212), before dispatching `LOAD_SAVED_VIEW_EVENT`:
- Track whether the user has manually changed `viewMode` with a ref (`userChangedModeRef`)
- If the user has changed mode, override `sv.viewMode` with the current `viewMode`
- This prevents the start view from resetting 2D back to 3D

### B. Fix issues default OFF (ViewerRightPanel.tsx)

Line 125: Change `useState(true)` to `useState(false)`.

### C. Improve A-model filter for Småviken (AssetPlusViewer.tsx)

The current filter checks DB `model_name`. Since Småviken's DB names are "Modell 1"/"Modell 2", add a fallback:
- After checking DB names, if no names start with "A", also check the Asset+ `GetAllRelatedModels` API response (already fetched via network) for model names containing "ARK" or starting with "A"
- Map those `bimObjectId` values to the `xkt_models` entries to build the whitelist

### D. Protect viewer from dialog-induced re-renders (IssueDetailSheet.tsx / SendIssueDialog.tsx)

- Ensure `SendIssueDialog.onClose()` does not trigger any state change that cascades up to unmount the viewer
- Move `SendIssueDialog` to be a portal rendered at root level rather than inside the Sheet hierarchy
- In `loadIssueAnnotations()`: before creating markers, clear existing markers first (container `innerHTML = ''`) to prevent duplicates on reload, rather than relying on the skip-if-exists check which doesn't clean up stale resolved issues

### E. Fix send-issue-email auth (edge function)

Replace `getClaims()` (which may not exist) with `getUser()` for token validation. Note that Resend test domain (`onboarding@resend.dev`) only delivers to verified addresses.

---

## Files Modified

| File | Change |
|---|---|
| `src/pages/UnifiedViewer.tsx` | Guard start view from overriding user-selected 2D mode |
| `src/components/viewer/ViewerRightPanel.tsx` | `showIssues` default to `false` |
| `src/components/viewer/AssetPlusViewer.tsx` | Improve A-model filter fallback; protect marker reload from clearing 3D |
| `src/components/viewer/IssueDetailSheet.tsx` | Render SendIssueDialog as portal to prevent re-render cascade |
| `supabase/functions/send-issue-email/index.ts` | Fix auth validation |

