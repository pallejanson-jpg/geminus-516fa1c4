-- Create storage bucket for issue screenshots
INSERT INTO storage.buckets (id, name, public) 
VALUES ('issue-screenshots', 'issue-screenshots', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: public read access for issue screenshots
CREATE POLICY "Issue screenshots are publicly accessible" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'issue-screenshots');

-- Storage policy: authenticated users can upload screenshots
CREATE POLICY "Authenticated users can upload issue screenshots" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'issue-screenshots' AND auth.uid() IS NOT NULL);

-- Storage policy: users can update their own screenshots
CREATE POLICY "Users can update own issue screenshots" 
ON storage.objects FOR UPDATE 
USING (bucket_id = 'issue-screenshots' AND auth.uid() IS NOT NULL);

-- Create bcf_issues table
CREATE TABLE public.bcf_issues (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    issue_type TEXT NOT NULL DEFAULT 'fault',
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'open',
    viewpoint_json JSONB,
    screenshot_url TEXT,
    building_fm_guid TEXT,
    building_name TEXT,
    selected_object_ids TEXT[],
    reported_by UUID NOT NULL,
    assigned_to UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID,
    CONSTRAINT bcf_issues_issue_type_check CHECK (issue_type IN ('fault', 'improvement', 'question', 'observation')),
    CONSTRAINT bcf_issues_priority_check CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    CONSTRAINT bcf_issues_status_check CHECK (status IN ('open', 'in_progress', 'resolved', 'closed'))
);

-- Create bcf_comments table
CREATE TABLE public.bcf_comments (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    issue_id UUID NOT NULL REFERENCES public.bcf_issues(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    comment TEXT NOT NULL,
    viewpoint_json JSONB,
    screenshot_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_bcf_issues_building ON public.bcf_issues(building_fm_guid);
CREATE INDEX idx_bcf_issues_status ON public.bcf_issues(status);
CREATE INDEX idx_bcf_issues_reported_by ON public.bcf_issues(reported_by);
CREATE INDEX idx_bcf_comments_issue_id ON public.bcf_comments(issue_id);

-- Enable RLS
ALTER TABLE public.bcf_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bcf_comments ENABLE ROW LEVEL SECURITY;

-- RLS policies for bcf_issues
CREATE POLICY "Authenticated users can read all issues"
ON public.bcf_issues FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create issues"
ON public.bcf_issues FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = reported_by);

CREATE POLICY "Admins can update all issues"
ON public.bcf_issues FOR UPDATE
USING (public.is_admin());

CREATE POLICY "Users can update own issues except status to resolved"
ON public.bcf_issues FOR UPDATE
USING (
    auth.uid() = reported_by 
    AND NOT public.is_admin()
);

CREATE POLICY "Admins can delete issues"
ON public.bcf_issues FOR DELETE
USING (public.is_admin());

-- RLS policies for bcf_comments
CREATE POLICY "Authenticated users can read comments"
ON public.bcf_comments FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create comments"
ON public.bcf_comments FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "Users can update own comments"
ON public.bcf_comments FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Admins can delete comments"
ON public.bcf_comments FOR DELETE
USING (public.is_admin());

-- Trigger for updated_at
CREATE TRIGGER update_bcf_issues_updated_at
BEFORE UPDATE ON public.bcf_issues
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for issues (notifications)
ALTER PUBLICATION supabase_realtime ADD TABLE public.bcf_issues;