-- Extend renovation_projects with room-level and system-type scope fields.
-- affected_room_fm_guids: specific rooms/spaces within the primary floors
-- affected_system_types: installation system disciplines that span beyond primary floors
-- scope_zone_description: free-text fallback for partial-floor zones

ALTER TABLE public.renovation_projects
  ADD COLUMN IF NOT EXISTS affected_room_fm_guids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS affected_system_types TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scope_zone_description TEXT;
