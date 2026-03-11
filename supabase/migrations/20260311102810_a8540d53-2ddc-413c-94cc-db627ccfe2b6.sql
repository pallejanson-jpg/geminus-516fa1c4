ALTER TABLE public.building_settings
  ADD COLUMN IF NOT EXISTS assetplus_api_url text,
  ADD COLUMN IF NOT EXISTS assetplus_api_key text,
  ADD COLUMN IF NOT EXISTS assetplus_keycloak_url text,
  ADD COLUMN IF NOT EXISTS assetplus_client_id text,
  ADD COLUMN IF NOT EXISTS assetplus_client_secret text,
  ADD COLUMN IF NOT EXISTS assetplus_username text,
  ADD COLUMN IF NOT EXISTS assetplus_password text,
  ADD COLUMN IF NOT EXISTS senslinc_api_url text,
  ADD COLUMN IF NOT EXISTS senslinc_email text,
  ADD COLUMN IF NOT EXISTS senslinc_password text;