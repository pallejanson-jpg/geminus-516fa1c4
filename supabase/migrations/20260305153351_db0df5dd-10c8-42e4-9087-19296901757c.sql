
-- 1. asset_external_ids: Maps external IDs from multiple sources to stable fm_guid
CREATE TABLE public.asset_external_ids (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fm_guid text NOT NULL,
    source text NOT NULL,
    external_id text NOT NULL,
    model_version text,
    last_seen_at timestamptz DEFAULT now(),
    created_at timestamptz DEFAULT now(),
    UNIQUE(fm_guid, source)
);

ALTER TABLE public.asset_external_ids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read asset_external_ids"
ON public.asset_external_ids FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins can manage asset_external_ids"
ON public.asset_external_ids FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 2. systems: Technical systems (e.g., LB01 Supply Air)
CREATE TABLE public.systems (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fm_guid text UNIQUE NOT NULL,
    name text NOT NULL,
    system_type text,
    discipline text,
    source text DEFAULT 'manual',
    building_fm_guid text,
    parent_system_id uuid REFERENCES public.systems(id),
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.systems ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read systems"
ON public.systems FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins can manage systems"
ON public.systems FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 3. asset_system: Many-to-many asset ↔ system
CREATE TABLE public.asset_system (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_fm_guid text NOT NULL,
    system_id uuid NOT NULL REFERENCES public.systems(id) ON DELETE CASCADE,
    role text,
    created_at timestamptz DEFAULT now(),
    UNIQUE(asset_fm_guid, system_id)
);

ALTER TABLE public.asset_system ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read asset_system"
ON public.asset_system FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins can manage asset_system"
ON public.asset_system FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 4. asset_connections: Topology/flow between assets
CREATE TABLE public.asset_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    from_fm_guid text NOT NULL,
    to_fm_guid text NOT NULL,
    connection_type text NOT NULL DEFAULT 'flow',
    direction text DEFAULT 'forward',
    source text DEFAULT 'ifc',
    created_at timestamptz DEFAULT now(),
    UNIQUE(from_fm_guid, to_fm_guid, connection_type)
);

ALTER TABLE public.asset_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read asset_connections"
ON public.asset_connections FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins can manage asset_connections"
ON public.asset_connections FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Add indexes for common queries
CREATE INDEX idx_asset_external_ids_external ON public.asset_external_ids(source, external_id);
CREATE INDEX idx_asset_external_ids_fm_guid ON public.asset_external_ids(fm_guid);
CREATE INDEX idx_systems_building ON public.systems(building_fm_guid);
CREATE INDEX idx_asset_system_asset ON public.asset_system(asset_fm_guid);
CREATE INDEX idx_asset_system_system ON public.asset_system(system_id);
CREATE INDEX idx_asset_connections_from ON public.asset_connections(from_fm_guid);
CREATE INDEX idx_asset_connections_to ON public.asset_connections(to_fm_guid);

-- Updated_at triggers
CREATE TRIGGER update_systems_updated_at BEFORE UPDATE ON public.systems
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
