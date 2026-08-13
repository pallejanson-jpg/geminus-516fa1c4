-- Add BCF viewpoint JSON column to saved_views.
-- Stores the full BCFViewpointsPlugin.getViewpoint() payload so camera,
-- section planes, and object visibility/color states can be fully restored.
ALTER TABLE public.saved_views
  ADD COLUMN IF NOT EXISTS bcf_viewpoint JSONB;
