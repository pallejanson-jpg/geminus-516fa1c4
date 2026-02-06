
ALTER TABLE public.qr_report_configs
  ADD COLUMN asset_fm_guid text,
  ADD COLUMN asset_name text,
  ADD COLUMN installation_number text;
