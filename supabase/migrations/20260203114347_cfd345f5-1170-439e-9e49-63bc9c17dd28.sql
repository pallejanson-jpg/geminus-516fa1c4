-- Add token storage columns to building_settings for automatic Ivion authentication
-- These columns allow the system to cache and automatically refresh Ivion tokens

ALTER TABLE public.building_settings
ADD COLUMN IF NOT EXISTS ivion_access_token text,
ADD COLUMN IF NOT EXISTS ivion_refresh_token text,
ADD COLUMN IF NOT EXISTS ivion_token_expires_at timestamp with time zone;

-- Add comment for documentation
COMMENT ON COLUMN public.building_settings.ivion_access_token IS 'Cached Ivion JWT access token (~30 min validity)';
COMMENT ON COLUMN public.building_settings.ivion_refresh_token IS 'Ivion refresh token (~7 days validity) for automatic renewal';
COMMENT ON COLUMN public.building_settings.ivion_token_expires_at IS 'When the access token expires';