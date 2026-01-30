-- Detection templates configuration
CREATE TABLE public.detection_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  object_type TEXT NOT NULL UNIQUE,
  description TEXT,
  ai_prompt TEXT NOT NULL,
  default_symbol_id UUID REFERENCES public.annotation_symbols(id),
  default_category TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.detection_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "detection_templates_read" ON public.detection_templates 
  FOR SELECT USING (true);
CREATE POLICY "detection_templates_admin_write" ON public.detection_templates 
  FOR ALL USING (public.is_admin());

-- Seed initial templates
INSERT INTO public.detection_templates (name, object_type, description, ai_prompt, default_category) VALUES
(
  'Fire Extinguisher', 
  'fire_extinguisher',
  'Red fire extinguisher cylinders, wall-mounted or floor-standing',
  'Look for red fire extinguisher cylinders. They are typically cylindrical, red or partially red, mounted on walls at about 1-1.5m height, or standing on the floor. May have hose attachment.',
  'fire_extinguisher'
),
(
  'Emergency Exit Sign',
  'emergency_exit',
  'Green illuminated signs with running figure, above doors or in corridors',
  'Look for green emergency exit signs. They show a running figure pictogram pointing to an exit. Usually illuminated, mounted above doors or high on walls. May include arrow direction.',
  'emergency_exit'
);

-- Scan jobs tracking
CREATE TABLE public.scan_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid TEXT NOT NULL,
  ivion_site_id TEXT NOT NULL,
  templates TEXT[] NOT NULL,
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed')),
  total_images INTEGER DEFAULT 0,
  processed_images INTEGER DEFAULT 0,
  current_dataset TEXT,
  current_image_index INTEGER DEFAULT 0,
  detections_found INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_by UUID REFERENCES public.profiles(user_id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.scan_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan_jobs_read" ON public.scan_jobs 
  FOR SELECT USING (true);
CREATE POLICY "scan_jobs_insert" ON public.scan_jobs 
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "scan_jobs_update" ON public.scan_jobs 
  FOR UPDATE USING (auth.uid() = created_by OR public.is_admin());

-- Pending detections queue
CREATE TABLE public.pending_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_job_id UUID NOT NULL REFERENCES public.scan_jobs(id) ON DELETE CASCADE,
  building_fm_guid TEXT NOT NULL,
  ivion_site_id TEXT NOT NULL,
  ivion_dataset_name TEXT,
  ivion_image_id INTEGER,
  detection_template_id UUID REFERENCES public.detection_templates(id),
  object_type TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  bounding_box JSONB NOT NULL,
  coordinate_x NUMERIC,
  coordinate_y NUMERIC,
  coordinate_z NUMERIC,
  thumbnail_url TEXT,
  ai_description TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'duplicate')),
  reviewed_by UUID REFERENCES public.profiles(user_id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_asset_fm_guid TEXT,
  created_ivion_poi_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pending_detections_status ON public.pending_detections(status);
CREATE INDEX idx_pending_detections_job ON public.pending_detections(scan_job_id);
CREATE INDEX idx_pending_detections_building ON public.pending_detections(building_fm_guid);

ALTER TABLE public.pending_detections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pending_detections_read" ON public.pending_detections 
  FOR SELECT USING (true);
CREATE POLICY "pending_detections_insert" ON public.pending_detections 
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "pending_detections_update" ON public.pending_detections 
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Add storage bucket for detection thumbnails
INSERT INTO storage.buckets (id, name, public) VALUES ('detection-thumbnails', 'detection-thumbnails', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "detection_thumbnails_read" ON storage.objects 
  FOR SELECT USING (bucket_id = 'detection-thumbnails');
CREATE POLICY "detection_thumbnails_insert" ON storage.objects 
  FOR INSERT WITH CHECK (bucket_id = 'detection-thumbnails' AND auth.uid() IS NOT NULL);

-- Trigger for updated_at
CREATE TRIGGER update_detection_templates_updated_at
  BEFORE UPDATE ON public.detection_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();