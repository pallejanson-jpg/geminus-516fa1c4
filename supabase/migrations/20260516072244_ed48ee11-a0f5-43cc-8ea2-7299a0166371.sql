
-- fm_access_documents
DROP POLICY IF EXISTS "Service role can manage fm_access_documents" ON public.fm_access_documents;
CREATE POLICY "Service role can manage fm_access_documents"
ON public.fm_access_documents
FOR ALL
TO service_role
USING (true) WITH CHECK (true);

-- fm_access_drawings
DROP POLICY IF EXISTS "Service role can manage fm_access_drawings" ON public.fm_access_drawings;
CREATE POLICY "Service role can manage fm_access_drawings"
ON public.fm_access_drawings
FOR ALL
TO service_role
USING (true) WITH CHECK (true);

-- fm_access_dou
DROP POLICY IF EXISTS "Service role can manage fm_access_dou" ON public.fm_access_dou;
CREATE POLICY "Service role can manage fm_access_dou"
ON public.fm_access_dou
FOR ALL
TO service_role
USING (true) WITH CHECK (true);

-- asset_sync_progress
DROP POLICY IF EXISTS "Service role can manage sync progress" ON public.asset_sync_progress;
CREATE POLICY "Service role can manage sync progress"
ON public.asset_sync_progress
FOR ALL
TO service_role
USING (true) WITH CHECK (true);

-- asset_plus_endpoint_cache
DROP POLICY IF EXISTS "Service role can manage endpoint cache" ON public.asset_plus_endpoint_cache;
CREATE POLICY "Service role can manage endpoint cache"
ON public.asset_plus_endpoint_cache
FOR ALL
TO service_role
USING (true) WITH CHECK (true);

-- document_chunks
DROP POLICY IF EXISTS "Service role can manage document chunks" ON public.document_chunks;
CREATE POLICY "Service role can manage document chunks"
ON public.document_chunks
FOR ALL
TO service_role
USING (true) WITH CHECK (true);

-- Remove public read of XKT models (bucket is private)
DROP POLICY IF EXISTS "Allow public read of XKT models" ON storage.objects;
