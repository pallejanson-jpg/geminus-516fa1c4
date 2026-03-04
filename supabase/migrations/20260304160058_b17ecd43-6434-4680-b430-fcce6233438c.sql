
CREATE POLICY "Authenticated users can update IFC files"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'ifc-uploads')
WITH CHECK (bucket_id = 'ifc-uploads');
