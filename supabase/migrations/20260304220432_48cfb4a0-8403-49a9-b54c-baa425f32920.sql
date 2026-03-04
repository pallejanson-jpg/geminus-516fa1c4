
CREATE TABLE public.bip_reference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_type text NOT NULL,
  ref_id integer,
  code text,
  title text NOT NULL,
  parent_id integer,
  usercode_syntax text,
  bsab_e text,
  aff text,
  etim text,
  schema_id integer,
  raw_data jsonb DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.bip_reference ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read bip_reference"
  ON public.bip_reference FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage bip_reference"
  ON public.bip_reference FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE INDEX idx_bip_reference_ref_type ON public.bip_reference(ref_type);
CREATE INDEX idx_bip_reference_code ON public.bip_reference(code);
