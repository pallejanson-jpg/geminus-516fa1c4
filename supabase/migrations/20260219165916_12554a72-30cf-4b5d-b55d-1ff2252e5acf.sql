CREATE POLICY "Authenticated users can delete alarm assets"
ON public.assets FOR DELETE
USING (auth.uid() IS NOT NULL AND asset_type = 'IfcAlarm');