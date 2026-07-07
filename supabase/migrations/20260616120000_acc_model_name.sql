-- Add user-defined model name to acc_model_translations
-- This name flows through the pipeline: translate-model → check-translation → ifc-to-xkt / acc-geometry-extract → xkt_models
ALTER TABLE public.acc_model_translations
  ADD COLUMN IF NOT EXISTS model_name TEXT;
