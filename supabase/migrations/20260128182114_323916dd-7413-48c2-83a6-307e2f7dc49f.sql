-- Create viewer_themes table for storing custom color themes
CREATE TABLE public.viewer_themes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  color_mappings JSONB NOT NULL DEFAULT '{}'::jsonb,
  edge_settings JSONB DEFAULT '{}'::jsonb,
  space_opacity NUMERIC DEFAULT 0.25,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.viewer_themes ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public read access to viewer themes"
ON public.viewer_themes
FOR SELECT
USING (true);

-- Public insert access
CREATE POLICY "Public insert access to viewer themes"
ON public.viewer_themes
FOR INSERT
WITH CHECK (true);

-- Public update access
CREATE POLICY "Public update access to viewer themes"
ON public.viewer_themes
FOR UPDATE
USING (true);

-- Public delete access (only non-system themes)
CREATE POLICY "Public delete access to viewer themes"
ON public.viewer_themes
FOR DELETE
USING (is_system = false);

-- Create trigger for updated_at
CREATE TRIGGER update_viewer_themes_updated_at
BEFORE UPDATE ON public.viewer_themes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default themes
INSERT INTO public.viewer_themes (name, is_system, color_mappings, edge_settings, space_opacity) VALUES
('Standard', true, '{}'::jsonb, '{}'::jsonb, 1.0),
('Arkitektvy', true, '{
  "ifcwall": {"color": "#AFAA87", "edges": true},
  "ifcwallstandardcase": {"color": "#C2BEA2", "edges": true},
  "ifcdoor": {"color": "#5B776B", "edges": true},
  "ifcwindow": {"color": "#647D8A", "edges": true},
  "ifcslab": {"color": "#999B97", "edges": false},
  "ifcspace": {"color": "#E5E4E3", "opacity": 0.25},
  "ifcroof": {"color": "#999B97", "edges": false},
  "ifcfurnishingelement": {"color": "#738B77", "edges": false},
  "ifcbuildingelementproxy": {"color": "#738B77", "edges": false},
  "ifccovering": {"color": "#C2BEA2", "edges": false},
  "ifcstair": {"color": "#999B97", "edges": true},
  "ifcrailing": {"color": "#647D8A", "edges": true},
  "default": {"color": "#EEEEEE", "edges": false}
}'::jsonb, '{"enabled": true}'::jsonb, 0.25);