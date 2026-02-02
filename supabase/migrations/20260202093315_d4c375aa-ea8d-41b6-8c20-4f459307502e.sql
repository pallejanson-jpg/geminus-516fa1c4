-- Add start_view_id to building_settings for default view on building open
ALTER TABLE building_settings 
ADD COLUMN IF NOT EXISTS start_view_id UUID REFERENCES saved_views(id) ON DELETE SET NULL;