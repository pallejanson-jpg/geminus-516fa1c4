
-- document_chunks table for pre-indexed document and help doc content
CREATE TABLE public.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL DEFAULT 'document',
  source_id text,
  building_fm_guid text,
  file_name text,
  chunk_index integer NOT NULL DEFAULT 0,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read document chunks"
  ON public.document_chunks FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage document chunks"
  ON public.document_chunks FOR ALL
  USING (true)
  WITH CHECK (true);

-- help_doc_sources table for managing help doc URLs
CREATE TABLE public.help_doc_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name text NOT NULL,
  url text NOT NULL,
  last_indexed_at timestamptz,
  chunk_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.help_doc_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can manage help doc sources"
  ON public.help_doc_sources FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Authenticated users can read help doc sources"
  ON public.help_doc_sources FOR SELECT
  USING (auth.uid() IS NOT NULL);
