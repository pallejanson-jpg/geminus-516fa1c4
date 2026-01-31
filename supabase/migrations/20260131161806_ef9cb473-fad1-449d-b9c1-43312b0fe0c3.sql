-- Add extracted_properties column to pending_detections for storing brand, model, size, etc.
ALTER TABLE pending_detections 
ADD COLUMN IF NOT EXISTS extracted_properties JSONB DEFAULT '{}';