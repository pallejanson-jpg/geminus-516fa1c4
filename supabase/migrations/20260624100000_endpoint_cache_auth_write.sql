-- Allow authenticated users to write APS/API credentials to the endpoint cache.
-- Previously only service_role could write; admins could only read.
CREATE POLICY "Authenticated users can manage endpoint cache"
  ON public.geminus_plus_endpoint_cache
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
