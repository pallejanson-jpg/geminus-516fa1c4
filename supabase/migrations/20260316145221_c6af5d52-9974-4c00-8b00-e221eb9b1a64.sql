
CREATE TABLE public.navigation_graphs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid text NOT NULL,
  floor_fm_guid text,
  graph_data jsonb NOT NULL DEFAULT '{"type":"FeatureCollection","features":[]}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.navigation_graphs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read navigation graphs"
  ON public.navigation_graphs FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert navigation graphs"
  ON public.navigation_graphs FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update navigation graphs"
  ON public.navigation_graphs FOR UPDATE TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete navigation graphs"
  ON public.navigation_graphs FOR DELETE TO authenticated
  USING (true);

CREATE TRIGGER update_navigation_graphs_updated_at
  BEFORE UPDATE ON public.navigation_graphs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
