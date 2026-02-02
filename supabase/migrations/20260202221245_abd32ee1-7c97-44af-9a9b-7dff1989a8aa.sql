-- Create room_label_configs table for storing label presets
CREATE TABLE public.room_label_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  fields JSONB NOT NULL DEFAULT '["commonName", "designation"]',
  height_offset REAL NOT NULL DEFAULT 1.2,
  font_size REAL NOT NULL DEFAULT 10,
  scale_with_distance BOOLEAN NOT NULL DEFAULT true,
  click_action TEXT NOT NULL DEFAULT 'none' CHECK (click_action IN ('none', 'flyto', 'roomcard')),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.room_label_configs ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can read room label configs"
ON public.room_label_configs FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert room label configs"
ON public.room_label_configs FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update room label configs"
ON public.room_label_configs FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can delete room label configs"
ON public.room_label_configs FOR DELETE
TO authenticated
USING (true);

-- Seed default configs
INSERT INTO public.room_label_configs (name, fields, height_offset, click_action, is_default) VALUES
  ('Rumsnamn', '["commonName"]', 1.2, 'none', true),
  ('Namn och nummer', '["commonName", "designation"]', 1.2, 'none', false),
  ('Namn och area', '["commonName", "nta"]', 1.2, 'roomcard', false);