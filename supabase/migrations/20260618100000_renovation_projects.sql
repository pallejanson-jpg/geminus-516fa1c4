CREATE TABLE renovation_projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  building_fm_guid TEXT NOT NULL REFERENCES assets(fm_guid),
  name TEXT NOT NULL,
  acc_renovation_project_id TEXT,
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning','active','completed','archived')),
  affected_level_fm_guids TEXT[] DEFAULT '{}',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE renovation_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read"  ON renovation_projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "Creator insert"      ON renovation_projects FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "Creator update"      ON renovation_projects FOR UPDATE TO authenticated USING (created_by = auth.uid());
CREATE POLICY "Service role all"    ON renovation_projects TO service_role USING (true) WITH CHECK (true);

CREATE INDEX renovation_projects_building_idx ON renovation_projects(building_fm_guid);
CREATE INDEX renovation_projects_status_idx   ON renovation_projects(status);
