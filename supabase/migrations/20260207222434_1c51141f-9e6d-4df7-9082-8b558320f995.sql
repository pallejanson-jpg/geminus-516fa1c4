-- Add missing storage policies for xkt-models bucket
-- These are needed for the Cache-on-Load strategy to upload XKT models

-- Allow authenticated users to read XKT models
CREATE POLICY "Authenticated users can read XKT models"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'xkt-models');

-- Allow authenticated users to upload XKT models
CREATE POLICY "Authenticated users can upload XKT models"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'xkt-models');

-- Allow authenticated users to update XKT models (needed for upsert)
CREATE POLICY "Authenticated users can update XKT models"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'xkt-models');