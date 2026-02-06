
-- Create QR report configs table for mapping QR keys to buildings/rooms
CREATE TABLE public.qr_report_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_key TEXT UNIQUE NOT NULL,
  building_fm_guid TEXT NOT NULL,
  building_name TEXT,
  space_fm_guid TEXT,
  space_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.qr_report_configs ENABLE ROW LEVEL SECURITY;

-- Public can read active configs (needed for QR code lookups without auth)
CREATE POLICY "Anyone can read active qr configs"
  ON public.qr_report_configs FOR SELECT
  USING (is_active = true);

-- Only admins can manage configs
CREATE POLICY "Admins can manage qr configs"
  ON public.qr_report_configs FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Allow anonymous inserts to work_orders (for QR-based fault reports without auth)
CREATE POLICY "Anyone can insert fault reports"
  ON public.work_orders FOR INSERT
  WITH CHECK (status = 'open');

-- Allow anonymous/public read of their own submitted fault reports by external_id
CREATE POLICY "Anyone can read fault reports by external_id"
  ON public.work_orders FOR SELECT
  USING (external_id LIKE 'FR-%');
