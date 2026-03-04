
CREATE TABLE public.conversion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid text NOT NULL,
  ifc_storage_path text NOT NULL,
  model_name text,
  status text NOT NULL DEFAULT 'pending',
  progress integer DEFAULT 0,
  log_messages text[] DEFAULT '{}',
  result_model_id text,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.conversion_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own jobs" ON public.conversion_jobs
  FOR SELECT TO authenticated USING (created_by = auth.uid());

CREATE POLICY "Users can create jobs" ON public.conversion_jobs
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.conversion_jobs;
