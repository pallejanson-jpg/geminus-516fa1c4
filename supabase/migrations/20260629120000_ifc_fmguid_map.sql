-- Table: ifc_fmguid_map
-- Stores IFC GlobalId → FMGUID mappings for continuity across re-uploads.
-- When an IFC is re-uploaded, elements without an FMGuid property can be
-- matched by their IFC GlobalId to reuse the same FMGUID as last time.

CREATE TABLE public.ifc_fmguid_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid text NOT NULL,
  ifc_global_id text NOT NULL,     -- IFC STEP GlobalId (22-char base64)
  fm_guid text NOT NULL,           -- FMGUID assigned to this element
  element_name text,
  ifc_type text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (building_fm_guid, ifc_global_id)
);

CREATE INDEX ifc_fmguid_map_building_idx ON public.ifc_fmguid_map (building_fm_guid);

ALTER TABLE public.ifc_fmguid_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read ifc_fmguid_map"
  ON public.ifc_fmguid_map FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert ifc_fmguid_map"
  ON public.ifc_fmguid_map FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update ifc_fmguid_map"
  ON public.ifc_fmguid_map FOR UPDATE TO authenticated USING (true);

-- Storage bucket for raw IFC uploads (private, only authenticated users)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ifc-uploads',
  'ifc-uploads',
  false,
  524288000,  -- 500 MB
  ARRAY['application/octet-stream', 'model/ifc', 'application/x-step', 'text/plain']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload IFC files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ifc-uploads');

CREATE POLICY "Authenticated users can read own IFC files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ifc-uploads');

CREATE POLICY "Service role full access to ifc-uploads"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'ifc-uploads');
