ALTER TABLE public.viewer_themes
ADD COLUMN IF NOT EXISTS background_color TEXT;

UPDATE public.viewer_themes
SET background_color = '#E5E7EB'
WHERE background_color IS NULL;