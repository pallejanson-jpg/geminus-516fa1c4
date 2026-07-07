-- Track whether a translation is for the master (A) model or a secondary model.
-- Secondary models reuse storeys already created by the master model.
ALTER TABLE public.acc_model_translations
  ADD COLUMN IF NOT EXISTS is_master_model BOOLEAN DEFAULT TRUE;
