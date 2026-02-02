-- Create table for external links (mapping buildings to Congeria, etc.)
CREATE TABLE public.building_external_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid TEXT NOT NULL,
  system_name TEXT NOT NULL,            -- 'congeria', 'ivion', etc
  external_url TEXT NOT NULL,           -- Full URL to the folder/resource
  external_id TEXT,                     -- System-specific ID (e.g., "3272")
  display_name TEXT,                    -- Optional friendly name
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create unique constraint for building + system combo
CREATE UNIQUE INDEX idx_building_external_links_unique 
ON public.building_external_links(building_fm_guid, system_name);

-- Enable RLS
ALTER TABLE public.building_external_links ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can read building external links"
ON public.building_external_links FOR SELECT
USING (true);

CREATE POLICY "Admins can insert building external links"
ON public.building_external_links FOR INSERT
WITH CHECK (is_admin());

CREATE POLICY "Admins can update building external links"
ON public.building_external_links FOR UPDATE
USING (is_admin());

CREATE POLICY "Admins can delete building external links"
ON public.building_external_links FOR DELETE
USING (is_admin());

-- Trigger for updated_at
CREATE TRIGGER update_building_external_links_updated_at
  BEFORE UPDATE ON public.building_external_links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create table for synced documents
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,              -- Path in Supabase Storage
  file_size INTEGER,
  mime_type TEXT,
  source_system TEXT NOT NULL DEFAULT 'congeria',
  source_url TEXT,                      -- Original URL from source system
  source_id TEXT,                       -- Source system's document ID
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,  -- Congeria metadata fields
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by building
CREATE INDEX idx_documents_building ON public.documents(building_fm_guid);
CREATE INDEX idx_documents_source ON public.documents(source_system, source_id);

-- Enable RLS
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can read documents"
ON public.documents FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can insert documents"
ON public.documents FOR INSERT
WITH CHECK (true);

CREATE POLICY "Authenticated users can update documents"
ON public.documents FOR UPDATE
USING (true);

CREATE POLICY "Admins can delete documents"
ON public.documents FOR DELETE
USING (is_admin());

-- Trigger for updated_at
CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for documents bucket
CREATE POLICY "Authenticated users can read documents"
ON storage.objects FOR SELECT
USING (bucket_id = 'documents' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can upload documents"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'documents' AND auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete documents from storage"
ON storage.objects FOR DELETE
USING (bucket_id = 'documents' AND is_admin());