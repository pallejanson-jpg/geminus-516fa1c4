
-- Allow admins to delete building_settings
CREATE POLICY "Admins can delete building settings"
ON public.building_settings
FOR DELETE
TO authenticated
USING (public.is_admin());

-- Allow admins to delete conversion_jobs
CREATE POLICY "Admins can delete conversion jobs"
ON public.conversion_jobs
FOR DELETE
TO authenticated
USING (public.is_admin());

-- Allow admins to view all conversion_jobs
CREATE POLICY "Admins can view all conversion jobs"
ON public.conversion_jobs
FOR SELECT
TO authenticated
USING (public.is_admin());
