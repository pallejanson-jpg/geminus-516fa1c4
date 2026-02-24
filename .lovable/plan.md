

## Plan: BCF Issue Email Notification and External Issue Resolution

### Overview

Extend the existing BCF issue system to allow admins to assign issues to registered users and notify them via email. Recipients receive a link to a dedicated public issue page where they can view the issue details (including 3D viewpoint), add comments, and mark the issue as resolved. Status changes propagate back to the admin in real-time.

---

### Architecture

```text
┌─────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│  Admin UI   │───▸│  Edge Function   │───▸│  Email (Resend API) │
│ (Assign +   │    │ send-issue-email │    │  with deep link     │
│  Send)      │    └──────────────────┘    └─────────────────────┘
└─────────────┘                                      │
       ▲                                             ▼
       │ realtime                          ┌─────────────────────┐
       │                                   │  /issue/:token      │
┌──────┴──────┐                            │  Public issue page  │
│ bcf_issues  │◀───────────────────────────│  (view, comment,    │
│ bcf_comments│                            │   resolve)          │
└─────────────┘                            └─────────────────────┘
```

---

### 1. Database Changes

#### 1a. Issue assignment tracking table

New table `bcf_issue_assignments` to track who an issue was sent to and their response:

```sql
CREATE TABLE public.bcf_issue_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL,
  assigned_to_user_id uuid NOT NULL,
  assigned_by_user_id uuid NOT NULL,
  token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  sent_at timestamptz DEFAULT now(),
  viewed_at timestamptz,
  responded_at timestamptz,
  response_status text, -- 'resolved', 'comment_only'
  created_at timestamptz DEFAULT now(),
  UNIQUE(issue_id, assigned_to_user_id)
);

ALTER TABLE public.bcf_issue_assignments ENABLE ROW LEVEL SECURITY;

-- Admins can manage assignments
CREATE POLICY "Admins can manage assignments" ON public.bcf_issue_assignments
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Assigned users can read and update their own assignments
CREATE POLICY "Users can read own assignments" ON public.bcf_issue_assignments
  FOR SELECT TO authenticated USING (auth.uid() = assigned_to_user_id);

CREATE POLICY "Users can update own assignments" ON public.bcf_issue_assignments
  FOR UPDATE TO authenticated USING (auth.uid() = assigned_to_user_id);

-- Public token-based access for the external page
CREATE POLICY "Token access for assignments" ON public.bcf_issue_assignments
  FOR SELECT TO anon USING (true);
```

#### 1b. Enable realtime on bcf_issues (if not already)

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.bcf_issue_assignments;
```

---

### 2. Edge Function: `send-issue-email`

New edge function that:
1. Validates the caller is an admin
2. Accepts `issue_id` and array of `user_ids` to notify
3. Fetches issue details and user profiles
4. Generates a unique token per assignment (stored in `bcf_issue_assignments`)
5. Sends email via Resend API (or Lovable AI model for generating email HTML)
6. The email contains:
   - Issue title, type, priority, description
   - Screenshot image (inline or linked)
   - Building name
   - Deep link: `{APP_URL}/issue/{token}`

```typescript
// supabase/functions/send-issue-email/index.ts
// POST { issue_id, user_ids: string[] }
// 1. Verify admin
// 2. Fetch issue from bcf_issues
// 3. For each user_id:
//    a. Upsert bcf_issue_assignments (get token)
//    b. Fetch profile for email/name
//    c. Send email with Resend
// 4. Update bcf_issues.assigned_to = first user_id (optional)
```

**Secret required:** `RESEND_API_KEY` for sending emails.

---

### 3. Public Issue Page: `/issue/:token`

New route and page component that:

1. **Token resolution**: Looks up `bcf_issue_assignments` by token to find the issue
2. **Authentication check**: If user is logged in, show full experience. If not, redirect to login with return URL
3. **Issue display**:
   - Screenshot with "Go to 3D" button
   - Issue title, type, priority, description
   - Building name and related objects
   - Comments thread (existing `bcf_comments`)
4. **3D Viewer embed**: Clicking "View in 3D" navigates to the unified viewer with the issue's viewpoint restored (using existing `restoreViewpoint` from `useBcfViewpoints`)
5. **Actions**:
   - Add comment (writes to `bcf_comments`)
   - "Mark as resolved" button → updates `bcf_issues.status` to `resolved` and `bcf_issue_assignments.response_status` to `resolved`
6. **Status feedback**: Updates `bcf_issue_assignments.responded_at` so admin sees real-time that the assignee has acted

```text
/issue/:token
├── IssueResolutionPage.tsx
│   ├── Issue header (title, type, priority badge)
│   ├── Screenshot + "Open in 3D" link
│   ├── Description
│   ├── Related objects
│   ├── Comments list + input
│   └── Action bar: [Add Comment] [Mark Resolved]
```

---

### 4. Admin UI: "Send Issue" from IssueDetailSheet

Add a "Send to user" button in `IssueDetailSheet.tsx` (visible to admins):

1. Opens a popover/dialog listing registered users (from `profiles` table)
2. Users can be selected (multi-select with checkboxes)
3. "Send" button calls the edge function
4. Shows confirmation toast
5. Assignment status badges appear on the issue card (sent, viewed, resolved)

UI additions in `IssueDetailSheet.tsx`:
```
[Send Issue]  →  Dialog with user list  →  [Send Email]
                 ☐ Mats Broman
                 ☐ Emelie Näslund
                 ☐ Louise Tranberg
```

---

### 5. Issue Status Flow

```text
Admin creates issue → status: "open"
Admin sends to user → assignment created, email sent
User opens link    → assignment.viewed_at set
User comments      → comment added to bcf_comments
User resolves      → bcf_issues.status = "resolved"
                     assignment.response_status = "resolved"
                     assignment.responded_at = now()
Admin sees update  → realtime subscription on bcf_issues
Admin can reopen   → status back to "open" if needed
```

---

### 6. Translate Existing Swedish Labels

The `IssueListPanel.tsx` and `IssueDetailSheet.tsx` still contain Swedish labels (`Ärenden`, `Öppna`, `Lösta`, `Kommentarer`, etc.). These will be translated to English as part of this work.

---

### Files to Create

| File | Purpose |
|---|---|
| `supabase/functions/send-issue-email/index.ts` | Edge function for sending issue emails |
| `src/pages/IssueResolution.tsx` | Public issue page for assignees |
| `src/components/viewer/SendIssueDialog.tsx` | User selection dialog for sending issues |
| `supabase/migrations/xxx_bcf_issue_assignments.sql` | New table + RLS |

### Files to Modify

| File | Changes |
|---|---|
| `src/components/viewer/IssueDetailSheet.tsx` | Add "Send to user" button, translate to English |
| `src/components/viewer/IssueListPanel.tsx` | Show assignment status badges, translate to English |
| `src/App.tsx` | Add `/issue/:token` route |
| `supabase/config.toml` | Add `send-issue-email` function config |

### Secret Required

| Secret | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend email service API key for sending issue notifications |

### Implementation Priority

| Step | Task | Complexity |
|---|---|---|
| 1 | Database migration (assignments table) | Small |
| 2 | Send issue dialog + user picker UI | Medium |
| 3 | Edge function for email sending | Medium |
| 4 | Issue resolution page (`/issue/:token`) | Medium |
| 5 | 3D viewpoint deep-link from resolution page | Small |
| 6 | Real-time status updates for admin | Small |
| 7 | Translate Swedish labels to English | Small |

