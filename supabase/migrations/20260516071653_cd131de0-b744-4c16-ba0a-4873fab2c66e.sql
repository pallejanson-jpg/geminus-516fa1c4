-- Fix acc_assetplus_guid_map: restrict ALL policy to service_role only
DROP POLICY IF EXISTS "Service role can manage guid map" ON public.acc_assetplus_guid_map;
CREATE POLICY "Service role can manage guid map"
  ON public.acc_assetplus_guid_map
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Fix xkt_models: restrict DELETE policy to authenticated role
DROP POLICY IF EXISTS "Authenticated users can delete xkt models" ON public.xkt_models;
CREATE POLICY "Authenticated users can delete xkt models"
  ON public.xkt_models
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);