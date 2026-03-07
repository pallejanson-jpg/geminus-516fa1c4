
-- FM Access Drawings cache
CREATE TABLE public.fm_access_drawings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid text NOT NULL,
  drawing_id text,
  object_id text,
  name text,
  class_name text,
  floor_name text,
  tab_name text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(building_fm_guid, drawing_id)
);

ALTER TABLE public.fm_access_drawings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read fm_access_drawings"
  ON public.fm_access_drawings FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role can manage fm_access_drawings"
  ON public.fm_access_drawings FOR ALL
  USING (true) WITH CHECK (true);

-- FM Access Documents cache
CREATE TABLE public.fm_access_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid text NOT NULL,
  document_id text,
  object_id text,
  name text,
  file_name text,
  class_name text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(building_fm_guid, document_id)
);

ALTER TABLE public.fm_access_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read fm_access_documents"
  ON public.fm_access_documents FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role can manage fm_access_documents"
  ON public.fm_access_documents FOR ALL
  USING (true) WITH CHECK (true);

-- FM Access DoU (Drift & Underhåll) cache
CREATE TABLE public.fm_access_dou (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_fm_guid text NOT NULL,
  building_fm_guid text,
  title text,
  content text,
  doc_type text DEFAULT 'instruction',
  synced_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fm_access_dou ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read fm_access_dou"
  ON public.fm_access_dou FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role can manage fm_access_dou"
  ON public.fm_access_dou FOR ALL
  USING (true) WITH CHECK (true);

-- Add fm_access sync type to faciliate_sync_state for tracking
INSERT INTO public.faciliate_sync_state (sync_type, sync_status)
VALUES ('fm_access_drawings', 'pending'), ('fm_access_documents', 'pending'), ('fm_access_dou', 'pending')
ON CONFLICT DO NOTHING;
