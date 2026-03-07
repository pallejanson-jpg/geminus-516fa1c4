

## Plan: Feedback System with Email Notifications, Duplicate Detection, and BCF/Saved View Object Restoration

### Part 1: BCF Issue — Restore Selected Objects on Return

**Problem:** When returning to a BCF issue, the camera flies correctly but selected objects aren't highlighted because `handleGoToIssueViewpoint` only reads from `viewpoint.components.selection` — which may be empty. The issue's `selected_object_ids` column is not used as a fallback.

**Fix:**
- **`handleGoToIssueViewpoint`** in both `VisualizationToolbar.tsx` and `ViewerRightPanel.tsx`: Accept a second parameter `fallbackObjectIds?: string[]`. If `viewpoint.components.selection` is empty, use `fallbackObjectIds` for selection + flash.
- **`handleSelectIssue`** in both files: Pass `issue.selected_object_ids` as fallback.
- **`IssueDetailSheet.tsx`**: Change `onGoToViewpoint` prop to also accept `selectedObjectIds`. When user clicks the screenshot, pass both `issue.viewpoint_json` and `issue.selected_object_ids`.
- **`restoreViewpoint`** in `useBcfViewpoints.ts`: Delay selection restoration to run after camera fly completes (use `setTimeout` matching duration).

### Part 2: Saved Views — Remember Visible Models

The `saved_views` table already has `visible_model_ids` and `visible_floor_ids` columns, and `captureViewState` already captures them. This is working. No changes needed here — the capture/restore pipeline already handles multi-model state.

### Part 3: Feedback System with Email + Duplicate Detection

**New DB tables** (migration):

```sql
CREATE TABLE public.feedback_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'suggestion',
  status text NOT NULL DEFAULT 'open',
  vote_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.feedback_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES public.feedback_threads(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  comment text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.feedback_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES public.feedback_threads(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(thread_id, user_id)
);
```
RLS: Authenticated users can CRUD own threads/comments/votes; admins can update thread status.

**Email notification:** When a user creates a feedback thread, use the existing `send-issue-email` pattern — call Resend API to notify admins. Create a lightweight edge function `feedback-notify` that:
1. Looks up all admin user_ids from `user_roles`
2. Gets their emails from `auth.users` (via service role)
3. Sends email via Resend with thread title, description, and link

**Duplicate detection:** Before submitting, search existing `feedback_threads` + `help_doc_sources` (indexed docs) for similar content:
- Query `feedback_threads` with `ilike` on title
- Query `document_chunks` with `ilike` on content (for help docs)
- Show matches in a panel: "Liknande ärenden finns redan" or "Denna funktion finns redan i Geminus"
- User can still submit if they want

**New UI files:**
- `src/components/support/FeedbackView.tsx` — List with category filters, vote counts, status badges, "Ny idé" button
- `src/components/support/FeedbackThreadDetail.tsx` — Sheet with comments, upvote, admin status control
- `src/components/support/FeedbackCreateForm.tsx` — Form with title/description/category + live duplicate detection panel

**Modified:**
- `src/components/support/CustomerPortalView.tsx` — Add "Feedback" tab

### Part 4: Shared Viewpoint Capture Utility

Both BCF issues and saved views capture camera + screenshot + model visibility. Extract a shared utility:

```typescript
// src/lib/viewpoint-capture.ts
export function captureViewerState(viewerRef): ViewerSnapshot {
  // Returns: screenshot, camera, visibleModelIds, visibleFloorIds, selectedObjectIds, clipHeight, projection
}
```

Use this in both `captureViewState` (saved views) and `captureIssueState` (BCF issues) to avoid code duplication.

### Files Modified/Created

- **New migration** — `feedback_threads`, `feedback_comments`, `feedback_votes`
- **New** — `supabase/functions/feedback-notify/index.ts`
- **New** — `src/lib/viewpoint-capture.ts`
- **New** — `src/components/support/FeedbackView.tsx`
- **New** — `src/components/support/FeedbackThreadDetail.tsx`
- **New** — `src/components/support/FeedbackCreateForm.tsx`
- **Modified** — `src/components/support/CustomerPortalView.tsx` (add Feedback tab)
- **Modified** — `src/hooks/useBcfViewpoints.ts` (delay selection after fly)
- **Modified** — `src/components/viewer/VisualizationToolbar.tsx` (fallback object IDs)
- **Modified** — `src/components/viewer/ViewerRightPanel.tsx` (fallback object IDs)
- **Modified** — `src/components/viewer/IssueDetailSheet.tsx` (pass selected_object_ids)

