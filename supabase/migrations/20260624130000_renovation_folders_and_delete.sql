-- Allow creators to delete their own renovation projects
CREATE POLICY "Creator delete" ON renovation_projects
  FOR DELETE TO authenticated USING (created_by = auth.uid());

-- Admins can also delete any project
CREATE POLICY "Admin delete" ON renovation_projects
  FOR DELETE TO authenticated USING (public.is_admin());

-- Add folder columns for same-project, folder-based ACC workflow
ALTER TABLE renovation_projects
  ADD COLUMN IF NOT EXISTS archive_folder_id   TEXT,
  ADD COLUMN IF NOT EXISTS archive_folder_name TEXT,
  ADD COLUMN IF NOT EXISTS renovation_folder_id   TEXT,
  ADD COLUMN IF NOT EXISTS renovation_folder_name TEXT;
