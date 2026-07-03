ALTER TABLE renovation_projects
  ADD COLUMN IF NOT EXISTS archive_file_item_ids JSONB,
  ADD COLUMN IF NOT EXISTS archive_file_names JSONB;
