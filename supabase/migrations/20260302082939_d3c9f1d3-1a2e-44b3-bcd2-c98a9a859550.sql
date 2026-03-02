ALTER TABLE public.support_cases
  ADD COLUMN IF NOT EXISTS location_description text,
  ADD COLUMN IF NOT EXISTS installation_number text,
  ADD COLUMN IF NOT EXISTS desired_date timestamptz;