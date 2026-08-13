-- Attach buildings and credential profiles to tenants; backfill existing
-- data into a "Demo" tenant so nothing currently visible disappears.

ALTER TABLE public.building_settings
  ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL;

ALTER TABLE public.api_profiles
  ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL;

-- At most one credential profile per tenant, so tenant-level credential
-- lookup (in _shared/credentials.ts) is always unambiguous.
CREATE UNIQUE INDEX api_profiles_one_per_tenant
  ON public.api_profiles (tenant_id)
  WHERE tenant_id IS NOT NULL;

DO $$
DECLARE
  demo_tenant_id uuid;
BEGIN
  INSERT INTO public.tenants (name) VALUES ('Demo')
  RETURNING id INTO demo_tenant_id;

  UPDATE public.building_settings
  SET tenant_id = demo_tenant_id
  WHERE tenant_id IS NULL;
END $$;

-- Close the public-read hole: building_settings holds live Asset+/Senslinc
-- credentials and Ivion tokens, it should never be readable by anon/public.
DROP POLICY IF EXISTS "Public read access to building settings" ON public.building_settings;

CREATE POLICY "Tenant members can read building settings"
  ON public.building_settings FOR SELECT
  TO authenticated
  USING (tenant_id IS NULL OR public.has_tenant_access(tenant_id));
