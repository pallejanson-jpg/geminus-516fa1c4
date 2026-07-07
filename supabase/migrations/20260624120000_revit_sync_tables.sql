-- Revit sync tables: levels, rooms, assets

-- revit_levels
create table if not exists public.revit_levels (
  id uuid primary key default gen_random_uuid(),
  external_guid text not null,
  model_id text not null,
  building_fm_guid text,
  name text,
  elevation_mm integer,
  synced_at timestamptz default now(),
  unique(model_id, external_guid)
);

alter table public.revit_levels enable row level security;

create policy "authenticated full access" on public.revit_levels
  for all
  to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- revit_rooms
create table if not exists public.revit_rooms (
  id uuid primary key default gen_random_uuid(),
  external_guid text not null,
  model_id text not null,
  building_fm_guid text,
  name text,
  number text,
  area_m2 numeric(10,2),
  level_guid text,
  level_name text,
  properties jsonb,
  geometry jsonb,
  space_outline jsonb,
  synced_at timestamptz default now(),
  unique(model_id, external_guid)
);

alter table public.revit_rooms enable row level security;

create policy "authenticated full access" on public.revit_rooms
  for all
  to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- revit_assets
create table if not exists public.revit_assets (
  id uuid primary key default gen_random_uuid(),
  external_guid text not null,
  model_id text not null,
  building_fm_guid text,
  name text,
  category text,
  family_name text,
  type_name text,
  room_guid text,
  level_guid text,
  properties jsonb,
  geometry jsonb,
  synced_at timestamptz default now(),
  unique(model_id, external_guid)
);

alter table public.revit_assets enable row level security;

create policy "authenticated full access" on public.revit_assets
  for all
  to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
