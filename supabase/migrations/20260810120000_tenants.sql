-- Multi-tenant support: tenants (customers) + per-user tenant access

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_tenant_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id)
);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tenant_access ENABLE ROW LEVEL SECURITY;

-- Admins implicitly have access to every tenant; other users need an explicit
-- user_tenant_access row. Mirrors the is_admin()/has_role() pattern.
CREATE OR REPLACE FUNCTION public.has_tenant_access(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.user_tenant_access
    WHERE user_id = auth.uid() AND tenant_id = _tenant_id
  )
$$;

CREATE POLICY "Tenant members can read tenants"
  ON public.tenants FOR SELECT
  TO authenticated
  USING (public.has_tenant_access(id));

CREATE POLICY "Admins can manage tenants"
  ON public.tenants FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can manage user_tenant_access"
  ON public.user_tenant_access FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
