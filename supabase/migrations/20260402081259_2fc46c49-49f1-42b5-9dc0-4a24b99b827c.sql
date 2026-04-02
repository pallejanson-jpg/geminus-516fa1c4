
-- Create api_profiles table for named credential sets
CREATE TABLE public.api_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  -- Asset+ credentials
  assetplus_api_url text,
  assetplus_api_key text,
  assetplus_keycloak_url text,
  assetplus_client_id text,
  assetplus_client_secret text,
  assetplus_username text,
  assetplus_password text,
  -- Senslinc credentials
  senslinc_api_url text,
  senslinc_email text,
  senslinc_password text,
  -- FM Access credentials
  fm_access_api_url text,
  fm_access_username text,
  fm_access_password text,
  -- Ivion credentials
  ivion_api_url text,
  ivion_username text,
  ivion_password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add api_profile_id to building_settings
ALTER TABLE public.building_settings
  ADD COLUMN api_profile_id uuid REFERENCES public.api_profiles(id) ON DELETE SET NULL;

-- Enable RLS
ALTER TABLE public.api_profiles ENABLE ROW LEVEL SECURITY;

-- Admin-only write
CREATE POLICY "Admins can manage api_profiles"
  ON public.api_profiles FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Authenticated read
CREATE POLICY "Authenticated users can read api_profiles"
  ON public.api_profiles FOR SELECT
  TO authenticated
  USING (true);

-- Seed a default profile (virtual — credentials come from env vars)
INSERT INTO public.api_profiles (name, is_default) VALUES ('Default (env vars)', true);

-- Updated_at trigger
CREATE TRIGGER update_api_profiles_updated_at
  BEFORE UPDATE ON public.api_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
