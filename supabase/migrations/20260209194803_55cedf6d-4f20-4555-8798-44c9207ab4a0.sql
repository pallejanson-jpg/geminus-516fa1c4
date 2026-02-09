
-- Create table to track ACC model translation status
CREATE TABLE public.acc_model_translations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version_urn TEXT NOT NULL,
  building_fm_guid TEXT,
  folder_id TEXT,
  file_name TEXT,
  translation_status TEXT NOT NULL DEFAULT 'pending',
  derivative_urn TEXT,
  output_format TEXT DEFAULT 'svf2',
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT acc_model_translations_version_urn_key UNIQUE (version_urn)
);

-- Enable RLS
ALTER TABLE public.acc_model_translations ENABLE ROW LEVEL SECURITY;

-- Admin-only policies (same pattern as other tables)
CREATE POLICY "Admins can manage translations"
  ON public.acc_model_translations
  FOR ALL
  USING (public.is_admin());

-- Trigger for updated_at
CREATE TRIGGER update_acc_model_translations_updated_at
  BEFORE UPDATE ON public.acc_model_translations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
