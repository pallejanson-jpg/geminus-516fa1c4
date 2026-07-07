-- Allow public read access to building_settings (auth removed, consistent with assets table)
DROP POLICY IF EXISTS "Admins can read building settings" ON public.building_settings;

CREATE POLICY "Public read access to building settings"
  ON public.building_settings FOR SELECT
  TO public
  USING (true);
