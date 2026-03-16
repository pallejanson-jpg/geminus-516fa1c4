-- Allow users to update their own conversion jobs (needed for browser-side conversion to mark as done)
CREATE POLICY "Users can update own jobs"
ON public.conversion_jobs
FOR UPDATE
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

-- Also allow service role to update all jobs
CREATE POLICY "Service role can manage all jobs"
ON public.conversion_jobs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);