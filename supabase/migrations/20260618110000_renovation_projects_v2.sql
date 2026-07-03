ALTER TABLE renovation_projects
  ADD COLUMN IF NOT EXISTS acc_account_id TEXT,
  ADD COLUMN IF NOT EXISTS archive_project_id TEXT,
  ADD COLUMN IF NOT EXISTS archive_folder_id TEXT,
  ADD COLUMN IF NOT EXISTS archive_file_item_id TEXT,
  ADD COLUMN IF NOT EXISTS archive_file_name TEXT,
  ADD COLUMN IF NOT EXISTS archive_version_urn TEXT,
  ADD COLUMN IF NOT EXISTS acc_setup_status TEXT DEFAULT 'pending'
    CHECK (acc_setup_status IN ('pending','creating','ready','error')),
  ADD COLUMN IF NOT EXISTS acc_setup_error TEXT;
