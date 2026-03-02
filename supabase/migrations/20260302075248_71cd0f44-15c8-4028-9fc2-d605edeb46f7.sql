
-- Create support_cases table
CREATE TABLE public.support_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'new',
  priority text NOT NULL DEFAULT 'medium',
  category text NOT NULL DEFAULT 'question',
  building_fm_guid text,
  building_name text,
  reported_by uuid NOT NULL,
  bcf_issue_id uuid REFERENCES public.bcf_issues(id),
  screenshot_url text,
  contact_email text,
  contact_phone text,
  external_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

-- Create support_case_comments table
CREATE TABLE public.support_case_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.support_cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  comment text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.support_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_case_comments ENABLE ROW LEVEL SECURITY;

-- RLS policies for support_cases
CREATE POLICY "Users can read own cases" ON public.support_cases
  FOR SELECT TO authenticated
  USING (auth.uid() = reported_by);

CREATE POLICY "Admins can read all cases" ON public.support_cases
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Users can create own cases" ON public.support_cases
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reported_by);

CREATE POLICY "Admins can update all cases" ON public.support_cases
  FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY "Users can update own cases" ON public.support_cases
  FOR UPDATE TO authenticated
  USING (auth.uid() = reported_by);

-- RLS policies for support_case_comments
CREATE POLICY "Authenticated users can read comments" ON public.support_case_comments
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can create own comments" ON public.support_case_comments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Updated_at trigger for support_cases
CREATE TRIGGER update_support_cases_updated_at
  BEFORE UPDATE ON public.support_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_cases;
