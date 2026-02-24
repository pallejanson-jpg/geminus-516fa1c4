
-- Create bcf_issue_assignments table
CREATE TABLE public.bcf_issue_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES public.bcf_issues(id) ON DELETE CASCADE,
  assigned_to_user_id uuid NOT NULL,
  assigned_by_user_id uuid NOT NULL,
  token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  sent_at timestamptz DEFAULT now(),
  viewed_at timestamptz,
  responded_at timestamptz,
  response_status text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(issue_id, assigned_to_user_id)
);

ALTER TABLE public.bcf_issue_assignments ENABLE ROW LEVEL SECURITY;

-- Admins can manage assignments
CREATE POLICY "Admins can manage assignments" ON public.bcf_issue_assignments
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Assigned users can read their own assignments
CREATE POLICY "Users can read own assignments" ON public.bcf_issue_assignments
  FOR SELECT TO authenticated USING (auth.uid() = assigned_to_user_id);

-- Assigned users can update their own assignments
CREATE POLICY "Users can update own assignments" ON public.bcf_issue_assignments
  FOR UPDATE TO authenticated USING (auth.uid() = assigned_to_user_id);

-- Token-based access for the external page (anon)
CREATE POLICY "Token access for assignments" ON public.bcf_issue_assignments
  FOR SELECT TO anon USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.bcf_issue_assignments;
