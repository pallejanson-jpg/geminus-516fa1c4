
-- api_profiles: admins only for SELECT
DROP POLICY IF EXISTS "Authenticated users can read api_profiles" ON public.api_profiles;
CREATE POLICY "Admins can read api_profiles"
  ON public.api_profiles FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- building_settings: admins only for SELECT/INSERT/UPDATE (DELETE already admin-only)
DROP POLICY IF EXISTS "Authenticated users can read building settings" ON public.building_settings;
DROP POLICY IF EXISTS "Authenticated users can update building settings" ON public.building_settings;
DROP POLICY IF EXISTS "Authenticated users can insert building settings" ON public.building_settings;

CREATE POLICY "Admins can read building settings"
  ON public.building_settings FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can insert building settings"
  ON public.building_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update building settings"
  ON public.building_settings FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- acc_oauth_tokens: restrict the catch-all policy to service_role only
DROP POLICY IF EXISTS "Service role can manage all ACC tokens" ON public.acc_oauth_tokens;
CREATE POLICY "Service role can manage all ACC tokens"
  ON public.acc_oauth_tokens FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- pending_detections: tighten UPDATE and remove anon read
DROP POLICY IF EXISTS "pending_detections_update" ON public.pending_detections;
DROP POLICY IF EXISTS "pending_detections_read" ON public.pending_detections;

CREATE POLICY "pending_detections_read"
  ON public.pending_detections FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "pending_detections_update"
  ON public.pending_detections FOR UPDATE
  TO authenticated
  USING (public.is_admin() OR auth.uid() = reviewed_by)
  WITH CHECK (public.is_admin() OR auth.uid() = reviewed_by);

-- scan_jobs: authenticated-only read
DROP POLICY IF EXISTS "scan_jobs_read" ON public.scan_jobs;
CREATE POLICY "scan_jobs_read"
  ON public.scan_jobs FOR SELECT
  TO authenticated
  USING (true);

-- documents: authenticated-only access
DROP POLICY IF EXISTS "Authenticated users can read documents" ON public.documents;
DROP POLICY IF EXISTS "Authenticated users can insert documents" ON public.documents;
DROP POLICY IF EXISTS "Authenticated users can update documents" ON public.documents;

CREATE POLICY "Authenticated users can read documents"
  ON public.documents FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert documents"
  ON public.documents FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update documents"
  ON public.documents FOR UPDATE
  TO authenticated
  USING (true);

-- work_orders: remove anon SELECT, keep anon INSERT for fault report submissions
DROP POLICY IF EXISTS "Anyone can read fault reports by external_id" ON public.work_orders;
CREATE POLICY "Authenticated users can read work_orders"
  ON public.work_orders FOR SELECT
  TO authenticated
  USING (true);

-- bcf_issue_assignments: remove broad anon read, replace with secure RPC
DROP POLICY IF EXISTS "Token access for assignments" ON public.bcf_issue_assignments;

CREATE OR REPLACE FUNCTION public.get_assignment_by_token(p_token text)
RETURNS SETOF public.bcf_issue_assignments
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.bcf_issue_assignments WHERE token = p_token LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.mark_assignment_viewed(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.bcf_issue_assignments
     SET viewed_at = now()
   WHERE token = p_token AND viewed_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_assignment(p_token text, p_status text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.bcf_issue_assignments
     SET response_status = p_status,
         responded_at = now()
   WHERE token = p_token;
$$;

GRANT EXECUTE ON FUNCTION public.get_assignment_by_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_assignment_viewed(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_assignment(text, text) TO anon, authenticated;
