INSERT INTO storage.buckets (id, name, public) VALUES ('ifc-uploads', 'ifc-uploads', false) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload IFC files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'ifc-uploads');

CREATE POLICY "Authenticated users can read IFC files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'ifc-uploads');

CREATE POLICY "Service role can manage IFC files"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'ifc-uploads');