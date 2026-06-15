-- Add BIM CadKey columns to faciliate_records so work orders can be
-- cross-referenced with Geminus Plus assets by FM GUID (building/floor/room).
-- These map to BuildingCadKey / FloorCadKey / RoomCadKey in the Faciliate API.
ALTER TABLE public.faciliate_records
  ADD COLUMN IF NOT EXISTS building_cad_key uuid,
  ADD COLUMN IF NOT EXISTS floor_cad_key    uuid,
  ADD COLUMN IF NOT EXISTS room_cad_key     uuid;

CREATE INDEX IF NOT EXISTS idx_faciliate_records_building_cad_key ON public.faciliate_records (building_cad_key);
CREATE INDEX IF NOT EXISTS idx_faciliate_records_floor_cad_key    ON public.faciliate_records (floor_cad_key);
CREATE INDEX IF NOT EXISTS idx_faciliate_records_room_cad_key     ON public.faciliate_records (room_cad_key);
