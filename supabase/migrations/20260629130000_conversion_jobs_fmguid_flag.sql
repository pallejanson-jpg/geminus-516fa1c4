-- Add use_fmguid_map flag to conversion_jobs.
-- When true, ifc-to-xkt will resolve FMGUIDs via ifc_fmguid_map + FMGuid property scan
-- rather than using IFC GlobalId directly as fm_guid.
-- Set to true by the IFC → Geminus Plus upload tool.

ALTER TABLE public.conversion_jobs
  ADD COLUMN IF NOT EXISTS use_fmguid_map boolean DEFAULT false;
