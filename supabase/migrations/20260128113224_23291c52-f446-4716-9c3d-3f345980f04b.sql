-- Create saved_views table for storing viewer states
CREATE TABLE public.saved_views (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  building_fm_guid TEXT NOT NULL,
  building_name TEXT,
  
  -- Screenshot (URL to storage)
  screenshot_url TEXT,
  
  -- Camera state
  camera_eye NUMERIC[],
  camera_look NUMERIC[],
  camera_up NUMERIC[],
  camera_projection TEXT DEFAULT 'perspective',
  
  -- Viewer settings
  view_mode TEXT DEFAULT '3d',
  clip_height NUMERIC DEFAULT 1.2,
  visible_model_ids TEXT[],
  visible_floor_ids TEXT[],
  
  -- Visualization state
  show_spaces BOOLEAN DEFAULT false,
  show_annotations BOOLEAN DEFAULT false,
  visualization_type TEXT DEFAULT 'none',
  visualization_mock_data BOOLEAN DEFAULT false,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Public read access to saved_views" ON public.saved_views FOR SELECT USING (true);
CREATE POLICY "Public insert access to saved_views" ON public.saved_views FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update access to saved_views" ON public.saved_views FOR UPDATE USING (true);
CREATE POLICY "Public delete access to saved_views" ON public.saved_views FOR DELETE USING (true);

-- Create storage bucket for view screenshots
INSERT INTO storage.buckets (id, name, public) VALUES ('saved-view-screenshots', 'saved-view-screenshots', true);

-- Storage policies
CREATE POLICY "Public read access to view screenshots" ON storage.objects FOR SELECT USING (bucket_id = 'saved-view-screenshots');
CREATE POLICY "Public insert access to view screenshots" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'saved-view-screenshots');
CREATE POLICY "Public delete access to view screenshots" ON storage.objects FOR DELETE USING (bucket_id = 'saved-view-screenshots');