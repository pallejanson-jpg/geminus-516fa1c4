-- Allow authenticated users to delete local-only assets
CREATE POLICY "Authenticated users can delete local assets"
  ON public.assets
  FOR DELETE
  TO authenticated
  USING (is_local = true);