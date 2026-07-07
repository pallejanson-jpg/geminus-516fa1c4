-- Allow storage_path to be NULL for direct-stream models
-- (models too large for Supabase Storage are fetched live from Asset+)
ALTER TABLE public.xkt_models ALTER COLUMN storage_path DROP NOT NULL;
