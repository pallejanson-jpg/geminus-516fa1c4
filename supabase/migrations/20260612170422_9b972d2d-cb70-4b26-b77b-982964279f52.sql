
ALTER TABLE public.building_settings
  ADD COLUMN IF NOT EXISTS geminus_base_building_guid text;

ALTER TABLE public.api_profiles
  ADD COLUMN IF NOT EXISTS geminus_base_api_url text,
  ADD COLUMN IF NOT EXISTS geminus_base_username text,
  ADD COLUMN IF NOT EXISTS geminus_base_password text;

CREATE TABLE IF NOT EXISTS public.geminus_base_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid text NOT NULL,
  document_id text,
  object_id text,
  name text,
  file_name text,
  class_name text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geminus_base_documents_building_doc_key UNIQUE (building_fm_guid, document_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.geminus_base_documents TO authenticated;
GRANT ALL ON public.geminus_base_documents TO service_role;

ALTER TABLE public.geminus_base_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read geminus_base_documents"
  ON public.geminus_base_documents FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role can manage geminus_base_documents"
  ON public.geminus_base_documents FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.geminus_base_dou (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_fm_guid text NOT NULL,
  building_fm_guid text,
  title text,
  content text,
  doc_type text DEFAULT 'instruction',
  synced_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.geminus_base_dou TO authenticated;
GRANT ALL ON public.geminus_base_dou TO service_role;

ALTER TABLE public.geminus_base_dou ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read geminus_base_dou"
  ON public.geminus_base_dou FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role can manage geminus_base_dou"
  ON public.geminus_base_dou FOR ALL TO service_role USING (true) WITH CHECK (true);
